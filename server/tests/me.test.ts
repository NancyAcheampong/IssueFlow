import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Integration test: real app, real database, a real signup + login to
// get a genuine token - proving requireAuth and GET /me actually work
// together, not just in isolation.
describe("GET /api/v1/me", () => {
  const app = createApp();
  const testEmail = `me-test-${Date.now()}@example.com`;
  const testPassword = "correct horse battery staple";
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const signupResponse = await request(app).post("/api/v1/auth/signup").send({
      email: testEmail,
      displayName: "Me Test User",
      password: testPassword,
    });
    userId = signupResponse.body.user.id;

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
      password: testPassword,
    });
    token = loginResponse.body.token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "me-test-" } } });
    await prisma.$disconnect();
  });

  it("returns the current user for a valid token", async () => {
    const response = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      id: userId,
      email: testEmail,
      displayName: "Me Test User",
    });
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a request with no token", async () => {
    const response = await request(app).get("/api/v1/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a request with an invalid token", async () => {
    const response = await request(app).get("/api/v1/me").set("Authorization", "Bearer garbage-token");

    expect(response.status).toBe(401);
  });
});
