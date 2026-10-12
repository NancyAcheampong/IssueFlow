import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestUser } from "./helpers/createTestUser.js";

// Oct 12: IssueFlow has no public signup - every account is provisioned
// here, by an ADMIN, instead. These tests cover what the old
// tests/auth.test.ts "POST /api/v1/auth/signup" describe block used to
// (creation, hashing, normalization, the duplicate-email conflict,
// validation), plus the authorization boundary that's new now: an
// unauthenticated or non-admin caller must not be able to create an
// account at all.
describe("POST /api/v1/admin/users", () => {
  const app = createApp();
  const runId = Date.now();
  const adminEmail = `admin-users-test-admin-${runId}@example.com`;
  const adminPassword = "correct horse battery staple";
  const memberEmail = `admin-users-test-member-${runId}@example.com`;
  const memberPassword = "correct horse battery staple";
  const testEmail = `admin-users-test-${runId}@example.com`;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    await createTestUser({
      email: adminEmail,
      displayName: "Admin",
      password: adminPassword,
      role: "ADMIN",
    });
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.token;

    await createTestUser({ email: memberEmail, displayName: "Member", password: memberPassword });
    const memberLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: memberPassword });
    memberToken = memberLogin.body.token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "admin-users-test" } } });
    await prisma.$disconnect();
  });

  it("creates a user and never returns the password or its hash", async () => {
    const response = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: testEmail,
        displayName: "Ada Lovelace",
        password: "correct horse battery staple",
      });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: testEmail,
      displayName: "Ada Lovelace",
      role: "MEMBER",
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
    await expect(
      bcrypt.compare("correct horse battery staple", stored!.passwordHash),
    ).resolves.toBe(true);
  });

  it("normalizes email (trims whitespace, lowercases) before storing", async () => {
    const messyEmail = `  Admin-Users-Test-Normalize-${runId}@Example.COM  `;

    const response = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: messyEmail,
        displayName: "Normalize Test",
        password: "correct horse battery staple",
      });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(messyEmail.trim().toLowerCase());
  });

  it("rejects a duplicate email with 409 CONFLICT", async () => {
    const response = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: testEmail,
        displayName: "Someone Else",
        password: "another valid password",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("rejects an invalid email with a 400 validation error", async () => {
    const response = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "not-an-email",
        displayName: "Someone",
        password: "correct horse battery staple",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.fields.email).toBeDefined();
  });

  it("rejects a password shorter than the minimum", async () => {
    const response = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: `admin-users-test-short-pw-${runId}@example.com`,
        displayName: "Someone",
        password: "short",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.password).toBeDefined();
  });

  it("rejects a missing display name", async () => {
    const response = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: `admin-users-test-no-name-${runId}@example.com`,
        password: "correct horse battery staple",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.displayName).toBeDefined();
  });

  it("rejects an unauthenticated request with 401", async () => {
    const response = await request(app)
      .post("/api/v1/admin/users")
      .send({
        email: `admin-users-test-noauth-${runId}@example.com`,
        displayName: "Someone",
        password: "correct horse battery staple",
      });

    expect(response.status).toBe(401);
  });

  it("rejects a non-admin member's request with 403", async () => {
    const response = await request(app)
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({
        email: `admin-users-test-forbidden-${runId}@example.com`,
        displayName: "Someone",
        password: "correct horse battery staple",
      });

    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/admin/users", () => {
  const app = createApp();
  const runId = Date.now();
  const adminEmail = `admin-users-test-list-admin-${runId}@example.com`;
  const adminPassword = "correct horse battery staple";
  const memberEmail = `admin-users-test-list-member-${runId}@example.com`;
  const memberPassword = "correct horse battery staple";
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    await createTestUser({
      email: adminEmail,
      displayName: "Admin",
      password: adminPassword,
      role: "ADMIN",
    });
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.token;

    await createTestUser({ email: memberEmail, displayName: "Member", password: memberPassword });
    const memberLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: memberPassword });
    memberToken = memberLogin.body.token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "admin-users-test-list" } } });
    await prisma.$disconnect();
  });

  it("lists users for an admin, including the admin itself", async () => {
    const response = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const emails = (response.body.users as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(adminEmail);
    expect(emails).toContain(memberEmail);
  });

  it("rejects a non-admin member's request with 403", async () => {
    const response = await request(app)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(403);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const response = await request(app).get("/api/v1/admin/users");

    expect(response.status).toBe(401);
  });
});
