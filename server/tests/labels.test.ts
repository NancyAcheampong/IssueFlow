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

describe("project label CRUD (LBL-01)", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `label-member-${runId}@example.com`;
  const outsiderEmail = `label-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let projectId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Label Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "Label Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Label Test Project" });
    projectId = project.body.project.id;
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  let bugLabelId: string;

  it("lets a project member create a label", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "bug", color: "#d73a4a" });

    expect(response.status).toBe(201);
    expect(response.body.label).toMatchObject({ name: "bug", color: "#d73a4a", projectId });
    bugLabelId = response.body.label.id;
  });

  it("rejects a non-hex color", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "invalid-color", color: "red" });

    expect(response.status).toBe(400);
  });

  it("rejects a duplicate label name within the same project", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "bug", color: "#000000" });

    expect(response.status).toBe(409);
  });

  it("lists a project's labels", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.labels.map((l: { name: string }) => l.name)).toContain("bug");
  });

  it("returns 404 for a non-member creating a label (D-06)", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ name: "should-not-exist", color: "#123456" });

    expect(response.status).toBe(404);
  });

  it("deletes a label", async () => {
    const response = await request(app)
      .delete(`/api/v1/projects/${projectId}/labels/${bugLabelId}`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(204);
  });

  it("returns 404 deleting a label that doesn't exist in this project", async () => {
    const response = await request(app)
      .delete(`/api/v1/projects/${projectId}/labels/not-a-real-label-id`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app).get(`/api/v1/projects/${projectId}/labels`);
    expect(response.status).toBe(401);
  });
});

describe("attaching/detaching labels on an issue (LBL-02)", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `issue-label-member-${runId}@example.com`;
  const outsiderEmail = `issue-label-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let projectAId: string;
  let projectBId: string;
  let issueId: string;
  let labelInProjectAId: string;
  let labelInProjectBId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Issue Label Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "Issue Label Outsider");
    outsiderToken = outsider.token;

    const projectA = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Issue Label Project A" });
    projectAId = projectA.body.project.id;

    const projectB = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Issue Label Project B" });
    projectBId = projectB.body.project.id;

    const issueResponse = await request(app)
      .post(`/api/v1/projects/${projectAId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Issue in project A" });
    issueId = issueResponse.body.issue.id;

    const labelA = await request(app)
      .post(`/api/v1/projects/${projectAId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "enhancement", color: "#a2eeef" });
    labelInProjectAId = labelA.body.label.id;

    const labelB = await request(app)
      .post(`/api/v1/projects/${projectBId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "wontfix", color: "#ffffff" });
    labelInProjectBId = labelB.body.label.id;
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("attaches a label from the issue's own project", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ labelId: labelInProjectAId });

    expect(response.status).toBe(200);
    expect(response.body.labels.map((l: { id: string }) => l.id)).toContain(labelInProjectAId);
  });

  it("rejects attaching a label that belongs to a different project (cross-project reference)", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ labelId: labelInProjectBId });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.labelId).toBeDefined();
  });

  it("rejects attaching the same label twice", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ labelId: labelInProjectAId });

    expect(response.status).toBe(409);
  });

  it("lists the labels currently on an issue", async () => {
    const response = await request(app)
      .get(`/api/v1/issues/${issueId}/labels`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.labels).toHaveLength(1);
    expect(response.body.labels[0].id).toBe(labelInProjectAId);
  });

  it("returns 404 for a non-member listing an issue's labels (D-06)", async () => {
    const response = await request(app)
      .get(`/api/v1/issues/${issueId}/labels`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(response.status).toBe(404);
  });

  it("detaches a label from an issue", async () => {
    const response = await request(app)
      .delete(`/api/v1/issues/${issueId}/labels/${labelInProjectAId}`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(204);
  });

  it("returns 404 detaching a label that isn't currently attached", async () => {
    const response = await request(app)
      .delete(`/api/v1/issues/${issueId}/labels/${labelInProjectAId}`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(404);
  });

  it("requires authentication to attach a label", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/labels`)
      .send({ labelId: labelInProjectAId });
    expect(response.status).toBe(401);
  });
});
