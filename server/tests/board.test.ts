import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const TEST_PASSWORD = "correct horse battery staple";

async function signupAndLogin(app: Express, email: string, displayName: string) {
  const signupResponse = await request(app).post("/api/v1/auth/signup").send({
    email,
    displayName,
    password: TEST_PASSWORD,
  });
  const loginResponse = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: TEST_PASSWORD });
  return {
    userId: signupResponse.body.user.id as string,
    token: loginResponse.body.token as string,
  };
}

describe("GET /api/v1/projects/:projectId/board", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `board-member-${runId}@example.com`;
  const outsiderEmail = `board-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let projectId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Board Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "Board Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Board Test Project" });
    projectId = project.body.project.id;

    // Three BACKLOG cards, created in order - the board should return
    // them in the same order (D-19: each new card ranks after the
    // last one in its column).
    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Backlog 1" });
    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Backlog 2" });
    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Backlog 3" });

    // One card straight into TODO - proves columns are independent.
    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Todo 1", status: "TODO" });
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("groups issues by status column", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/board`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.board.BACKLOG).toHaveLength(3);
    expect(response.body.board.TODO).toHaveLength(1);
    expect(response.body.board.IN_PROGRESS).toHaveLength(0);
    expect(response.body.board.DONE).toHaveLength(0);
  });

  it("orders cards within a column by rank, matching creation order (D-19)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/board`)
      .set("Authorization", `Bearer ${memberToken}`);

    const titles = (response.body.board.BACKLOG as { title: string }[]).map((i) => i.title);
    expect(titles).toEqual(["Backlog 1", "Backlog 2", "Backlog 3"]);
  });

  it("includes each card's board placement (rank, version)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/board`)
      .set("Authorization", `Bearer ${memberToken}`);

    const [first] = response.body.board.TODO;
    expect(first.boardPlacement).toMatchObject({ projectId, version: 0 });
    expect(typeof first.boardPlacement.rank).toBe("string");
  });

  it("returns 404 for someone with no membership in the project (D-06)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/board`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app).get(`/api/v1/projects/${projectId}/board`);
    expect(response.status).toBe(401);
  });
});
