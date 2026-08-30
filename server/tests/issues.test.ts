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
  const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password: TEST_PASSWORD });
  return { userId: signupResponse.body.user.id as string, token: loginResponse.body.token as string };
}

describe("POST /api/v1/projects/:projectId/issues", () => {
  const app = createApp();
  const runId = Date.now();
  const ownerEmail = `create-issue-owner-${runId}@example.com`;
  const memberEmail = `create-issue-member-${runId}@example.com`;
  const outsiderEmail = `create-issue-outsider-${runId}@example.com`;
  let ownerToken: string;
  let memberToken: string;
  let memberId: string;
  let outsiderToken: string;
  let projectId: string;

  beforeAll(async () => {
    const owner = await signupAndLogin(app, ownerEmail, "Create Issue Owner");
    ownerToken = owner.token;
    const member = await signupAndLogin(app, memberEmail, "Create Issue Member");
    memberToken = member.token;
    memberId = member.userId;
    const outsider = await signupAndLogin(app, outsiderEmail, "Create Issue Outsider");
    outsiderToken = outsider.token;

    const projectResponse = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Create Issue Test Project" });
    projectId = projectResponse.body.project.id;

    await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: memberEmail });
  });

  afterAll(async () => {
    const emails = [ownerEmail, memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("lets any project member (not just the owner) create an issue with a board placement (ISS-01)", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "First issue", description: "Some detail" });

    expect(response.status).toBe(201);
    expect(response.body.issue).toMatchObject({
      title: "First issue",
      description: "Some detail",
      status: "BACKLOG",
      number: 1,
    });
    expect(response.body.issue.boardPlacement).toBeTruthy();
    expect(response.body.issue.boardPlacement.projectId).toBe(projectId);
  });

  it("assigns sequential per-project numbers, not global ones", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Second issue" });

    expect(response.status).toBe(201);
    expect(response.body.issue.number).toBe(2);
  });

  it("accepts an explicit status and a valid assignee", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "In progress from the start", status: "IN_PROGRESS", assigneeId: memberId });

    expect(response.status).toBe(201);
    expect(response.body.issue.status).toBe("IN_PROGRESS");
    expect(response.body.issue.assigneeId).toBe(memberId);
  });

  it("rejects an assignee who isn't a current project member (ASN-02)", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Bad assignee", assigneeId: "not-a-real-member-id" });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.assigneeId).toBeDefined();
  });

  it("rejects a missing title", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ description: "no title given" });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.title).toBeDefined();
  });

  it("returns 404 for someone with no membership in the project at all (D-06)", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ title: "Should not be created" });

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app).post(`/api/v1/projects/${projectId}/issues`).send({ title: "No auth" });
    expect(response.status).toBe(401);
  });
});
