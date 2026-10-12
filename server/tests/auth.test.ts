import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { verifyAccessToken } from "../src/lib/jwt.js";
import { createTestUser } from "./helpers/createTestUser.js";

// POST /api/v1/auth/signup no longer exists (Oct 12 - see
// tests/adminUsers.test.ts for account-creation coverage now that it's
// an admin-only action). This file keeps only what's still genuinely
// about authenticating an existing account.
describe("POST /api/v1/auth/login", () => {
  const app = createApp();
  const testEmail = `login-test-${Date.now()}@example.com`;
  const testPassword = "correct horse battery staple";
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser({
      email: testEmail,
      displayName: "Login Test User",
      password: testPassword,
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "login-test-" } } });
    await prisma.$disconnect();
  });

  it("logs in with correct credentials and returns a working JWT", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
      password: testPassword,
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: userId, email: testEmail });
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(typeof response.body.token).toBe("string");

    // Prove the token isn't just some opaque string - decode it with our
    // own verifier and confirm it actually identifies this user.
    const payload = verifyAccessToken(response.body.token);
    expect(payload.sub).toBe(userId);
  });

  it("rejects the wrong password with a generic message", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
      password: "not the right password",
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(response.body.error.message).toBe("Invalid email or password.");
    expect(response.body.token).toBeUndefined();
  });

  it("rejects a non-existent email with the exact same generic message", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: "no-such-account@example.com",
      password: testPassword,
    });

    // The whole point of AUTH-07: this response must be indistinguishable
    // from the wrong-password case above, or the endpoint leaks which
    // emails have accounts.
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(response.body.error.message).toBe("Invalid email or password.");
  });

  it("rejects a login attempt with a missing password", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.fields.password).toBeDefined();
  });
});
