import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../src/app.js";
import { attachRealtime } from "../src/realtime/socket.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestUser } from "./helpers/createTestUser.js";

// Phase 5/D-24/D-25: unlike every other test file in this suite, this
// one needs a *real* listening HTTP server (Supertest's "pass the app
// straight to superagent" trick works for plain HTTP, but Socket.IO
// needs an actual socket to connect to) - createServer(app) +
// attachRealtime + .listen(0) (OS-assigned free port) gives both a
// real WebSocket endpoint and a real REST endpoint on the same port,
// matching how src/index.ts wires them together for real.
const TEST_PASSWORD = "correct horse battery staple";

describe("Realtime (Socket.IO)", () => {
  const app = createApp();
  let httpServer: Server;
  let baseUrl: string;

  const runId = Date.now();
  const memberEmail = `realtime-member-${runId}@example.com`;
  const outsiderEmail = `realtime-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let projectId: string;

  beforeAll(async () => {
    httpServer = createServer(app);
    attachRealtime(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    baseUrl = `http://localhost:${port}`;

    await createTestUser({
      email: memberEmail,
      displayName: "Realtime Member",
      password: TEST_PASSWORD,
    });
    const memberLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: TEST_PASSWORD });
    memberToken = memberLogin.body.token;

    await createTestUser({
      email: outsiderEmail,
      displayName: "Realtime Outsider",
      password: TEST_PASSWORD,
    });
    const outsiderLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: outsiderEmail, password: TEST_PASSWORD });
    outsiderToken = outsiderLogin.body.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Realtime Test Project" });
    projectId = project.body.project.id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  function connect(token?: string): ClientSocket {
    return ioClient(baseUrl, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      forceNew: true,
    });
  }

  it("rejects a connection with no token", async () => {
    const socket = connect();
    const err = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(err.message).toMatch(/authentication required/i);
    socket.close();
  });

  it("rejects a connection with an invalid token", async () => {
    const socket = connect("not-a-real-token");
    const err = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(err.message).toMatch(/invalid or expired/i);
    socket.close();
  });

  it("accepts a connection with a valid token", async () => {
    const socket = connect(memberToken);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    expect(socket.connected).toBe(true);
    socket.close();
  });

  it("lets a project member join that project's room", async () => {
    const socket = connect(memberToken);
    await new Promise<void>((resolve) => socket.on("connect", resolve));

    const outcome = await new Promise<string>((resolve) => {
      socket.on("join:ok", () => resolve("ok"));
      socket.on("join:error", () => resolve("error"));
      socket.emit("join", projectId);
    });

    expect(outcome).toBe("ok");
    socket.close();
  });

  it("rejects joining a project the socket's user has no membership in (D-06)", async () => {
    const socket = connect(outsiderToken);
    await new Promise<void>((resolve) => socket.on("connect", resolve));

    const outcome = await new Promise<string>((resolve) => {
      socket.on("join:ok", () => resolve("ok"));
      socket.on("join:error", () => resolve("error"));
      socket.emit("join", projectId);
    });

    expect(outcome).toBe("error");
    socket.close();
  });

  it("broadcasts project:changed to a joined socket after a real issue is created (D-25)", async () => {
    const socket = connect(memberToken);
    await new Promise<void>((resolve) => socket.on("connect", resolve));
    await new Promise<void>((resolve) => {
      socket.on("join:ok", () => resolve());
      socket.emit("join", projectId);
    });

    const changePromise = new Promise<{ type: string }>((resolve) =>
      socket.on("project:changed", resolve),
    );

    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Triggers a broadcast" });

    const change = await changePromise;
    expect(change.type).toBe("issue");
    socket.close();
  });

  it("does not broadcast to a socket that never joined the project's room", async () => {
    const socket = connect(memberToken);
    await new Promise<void>((resolve) => socket.on("connect", resolve));
    // Deliberately never emits "join" - the broadcast should never
    // reach this socket, proving join is a real gate, not decorative.

    let received = false;
    socket.on("project:changed", () => {
      received = true;
    });

    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Should not reach an unjoined socket" });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received).toBe(false);
    socket.close();
  });
});
