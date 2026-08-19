import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { verifyAccessToken } from "../src/lib/jwt.js";

// Integration tests: real app, real database (issueflow_test). Proves
// the whole path - validation, normalization, hashing, the unique
// constraint - actually works together, not just that each piece looks
// right in isolation.
describe("POST /api/v1/auth/signup", () => {
  const app = createApp();
  const testEmail = `signup-test-${Date.now()}@example.com`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "signup-test-" } } });
    await prisma.$disconnect();
  });

  it("creates a user and never returns the password or its hash", async () => {
    const response = await request(app).post("/api/v1/auth/signup").send({
      email: testEmail,
      displayName: "Ada Lovelace",
      password: "correct horse battery staple",
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: testEmail,
      displayName: "Ada Lovelace",
    });
    expect(response.body.user.id).toBeTruthy();
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.body.user.password).toBeUndefined();
  });

  it("actually hashes the password in the database - not stored in plain text", async () => {
    const stored = await prisma.user.findUnique({ where: { email: testEmail } });

    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe("correct horse battery staple");
    // Confirm it's a real bcrypt hash the original password verifies against,
    // not just "some other string" - proves the hash is actually usable.
    await expect(bcrypt.compare("correct horse battery staple", stored!.passwordHash)).resolves.toBe(true);
  });

  it("normalizes email (trims whitespace, lowercases) before storing", async () => {
    const messyEmail = `  Signup-Test-Normalize-${Date.now()}@Example.COM  `;

    const response = await request(app).post("/api/v1/auth/signup").send({
      email: messyEmail,
      displayName: "Normalize Test",
      password: "correct horse battery staple",
    });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(messyEmail.trim().toLowerCase());
  });

  it("rejects a duplicate email with 409 CONFLICT", async () => {
    const response = await request(app).post("/api/v1/auth/signup").send({
      email: testEmail,
      displayName: "Someone Else",
      password: "another valid password",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("rejects an invalid email with a 400 validation error", async () => {
    const response = await request(app).post("/api/v1/auth/signup").send({
      email: "not-an-email",
      displayName: "Someone",
      password: "correct horse battery staple",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.fields.email).toBeDefined();
  });

  it("rejects a password shorter than the minimum", async () => {
    const response = await request(app).post("/api/v1/auth/signup").send({
      email: `signup-test-short-pw-${Date.now()}@example.com`,
      displayName: "Someone",
      password: "short",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.password).toBeDefined();
  });

  it("rejects a missing display name", async () => {
    const response = await request(app).post("/api/v1/auth/signup").send({
      email: `signup-test-no-name-${Date.now()}@example.com`,
      password: "correct horse battery staple",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.displayName).toBeDefined();
  });
});

describe("POST /api/v1/auth/login", () => {
  const app = createApp();
  const testEmail = `login-test-${Date.now()}@example.com`;
  const testPassword = "correct horse battery staple";
  let userId: string;

  beforeAll(async () => {
    const signupResponse = await request(app).post("/api/v1/auth/signup").send({
      email: testEmail,
      displayName: "Login Test User",
      password: testPassword,
    });
    userId = signupResponse.body.user.id;
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
