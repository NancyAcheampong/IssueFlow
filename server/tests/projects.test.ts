import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const TEST_PASSWORD = "correct horse battery staple";

// Shared by the multi-user tests below (list isolation, add-member
// authorization) - signs a fresh account up and logs it in, returns
// enough to act as that user in subsequent requests.
async function signupAndLogin(app: Express, email: string, displayName: string) {
  const signupResponse = await request(app).post("/api/v1/auth/signup").send({
    email,
    displayName,
    password: TEST_PASSWORD,
  });
  const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password: TEST_PASSWORD });
  return { userId: signupResponse.body.user.id as string, token: loginResponse.body.token as string };
}

// Integration test: real app, real database, a genuine signup+login
// token - proving POST /api/v1/projects actually does what PRJ-01
// requires, not just that it returns the right shape.
describe("POST /api/v1/projects", () => {
  const app = createApp();
  const testEmail = `projects-route-test-${Date.now()}@example.com`;
  const testPassword = "correct horse battery staple";
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const signupResponse = await request(app).post("/api/v1/auth/signup").send({
      email: testEmail,
      displayName: "Projects Route Test",
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
    // Project.ownerId is ON DELETE RESTRICT, so projects have to go
    // before the user that owns them.
    await prisma.project.deleteMany({ where: { owner: { email: testEmail } } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  it("creates a project and makes the creator both owner and first member (PRJ-01)", async () => {
    const response = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "IssueFlow Itself", description: "The project we're building" });

    expect(response.status).toBe(201);
    expect(response.body.project).toMatchObject({
      name: "IssueFlow Itself",
      description: "The project we're building",
      ownerId: userId,
    });

    // Not just the project row's ownerId - prove a real ProjectMembership
    // row with role OWNER actually exists for this exact pair, since
    // that's the part PRJ-01 is actually about.
    const membership = await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId: response.body.project.id, userId } },
    });
    expect(membership).toMatchObject({ role: "OWNER" });
  });

  it("requires authentication", async () => {
    const response = await request(app).post("/api/v1/projects").send({ name: "No Auth" });

    expect(response.status).toBe(401);
  });

  it("rejects a missing name", async () => {
    const response = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "no name given" });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.name).toBeDefined();
  });

  it("allows creating a project with no description - it's optional", async () => {
    const response = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Description Project" });

    expect(response.status).toBe(201);
    expect(response.body.project.description).toBeNull();
  });
});

describe("GET /api/v1/projects", () => {
  const app = createApp();
  const runId = Date.now();
  const emailA = `list-projects-a-${runId}@example.com`;
  const emailB = `list-projects-b-${runId}@example.com`;
  let tokenA: string;

  beforeAll(async () => {
    const userA = await signupAndLogin(app, emailA, "List Test A");
    tokenA = userA.token;
    const userB = await signupAndLogin(app, emailB, "List Test B");

    await request(app).post("/api/v1/projects").set("Authorization", `Bearer ${tokenA}`).send({ name: "A's Project" });
    await request(app).post("/api/v1/projects").set("Authorization", `Bearer ${userB.token}`).send({ name: "B's Project" });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { owner: { email: { in: [emailA, emailB] } } } });
    await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await prisma.$disconnect();
  });

  it("returns only projects the requester belongs to - not everyone's (PRJ-02)", async () => {
    const response = await request(app).get("/api/v1/projects").set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(200);
    const names = (response.body.projects as { name: string }[]).map((p) => p.name);
    expect(names).toContain("A's Project");
    expect(names).not.toContain("B's Project");
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/projects");
    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/projects/:projectId/members", () => {
  const app = createApp();
  const runId = Date.now();
  const ownerEmail = `add-member-owner-${runId}@example.com`;
  const memberEmail = `add-member-target-${runId}@example.com`;
  const outsiderEmail = `add-member-outsider-${runId}@example.com`;
  let ownerToken: string;
  let memberToken: string;
  let outsiderToken: string;
  let projectId: string;

  beforeAll(async () => {
    const owner = await signupAndLogin(app, ownerEmail, "Add Member Owner");
    ownerToken = owner.token;
    // memberEmail just needs to exist as a registered account - added
    // to the project explicitly in the tests below, not here.
    const member = await signupAndLogin(app, memberEmail, "Add Member Target");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "Add Member Outsider");
    outsiderToken = outsider.token;

    const projectResponse = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Membership Test Project" });
    projectId = projectResponse.body.project.id;
  });

  afterAll(async () => {
    const emails = [ownerEmail, memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("lets the owner add an existing registered user by email (PRJ-03)", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: memberEmail });

    expect(response.status).toBe(201);
    expect(response.body.member.email).toBe(memberEmail);

    const membership = await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId: response.body.member.id } },
    });
    expect(membership).toMatchObject({ role: "MEMBER" });
  });

  it("rejects adding the same member twice with 409 CONFLICT", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: memberEmail });

    expect(response.status).toBe(409);
  });

  it("returns a safe not-found for an email with no account", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "no-such-account@example.com" });

    expect(response.status).toBe(404);
  });

  it("returns 404 for someone who isn't a member of the project at all (D-06)", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ email: outsiderEmail });

    expect(response.status).toBe(404);
  });

  it("returns 403 for a member who isn't the owner (D-06)", async () => {
    // memberEmail was added to the project in the first test above, so
    // this account is a real member now - just not the owner.
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ email: outsiderEmail });

    expect(response.status).toBe(403);
  });

  it("requires authentication", async () => {
    const response = await request(app).post(`/api/v1/projects/${projectId}/members`).send({ email: memberEmail });
    expect(response.status).toBe(401);
  });
});
