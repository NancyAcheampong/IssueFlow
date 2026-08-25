import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

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
