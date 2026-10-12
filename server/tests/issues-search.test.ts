import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestUser } from "./helpers/createTestUser.js";

const TEST_PASSWORD = "correct horse battery staple";

async function signupAndLogin(app: Express, email: string, displayName: string) {
  const user = await createTestUser({ email, displayName, password: TEST_PASSWORD });
  const loginResponse = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: TEST_PASSWORD });
  return { userId: user.id, token: loginResponse.body.token as string };
}

// SRC-01/02/03: keyword search and filters on GET
// /api/v1/projects/:projectId/issues, with "seeded data" deliberately
// shaped to prove both accuracy and project-scoping - a second
// project with a *same-titled* issue is the whole point of several
// tests below (Phase 6 exit gate: "search and filters stay accurate
// and project-scoped with seeded data").
describe("GET /api/v1/projects/:projectId/issues - search & filters", () => {
  const app = createApp();
  const runId = Date.now();
  const ownerEmail = `search-owner-${runId}@example.com`;
  const memberEmail = `search-member-${runId}@example.com`;
  const outsiderEmail = `search-outsider-${runId}@example.com`;
  let ownerToken: string;
  let memberId: string;
  let outsiderToken: string;
  let projectId: string;
  let bugLabelId: string;
  let featureLabelId: string;

  beforeAll(async () => {
    const owner = await signupAndLogin(app, ownerEmail, "Search Owner");
    ownerToken = owner.token;
    const member = await signupAndLogin(app, memberEmail, "Search Member");
    memberId = member.userId;
    const outsider = await signupAndLogin(app, outsiderEmail, "Search Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Search Test Project" });
    projectId = project.body.project.id;

    await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: memberEmail });

    const bugLabel = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "bug", color: "#d73a4a" });
    bugLabelId = bugLabel.body.label.id;

    const featureLabel = await request(app)
      .post(`/api/v1/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "feature", color: "#a2eeef" });
    featureLabelId = featureLabel.body.label.id;

    // Issue 1: BACKLOG, unassigned, labeled "bug".
    const issue1 = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Fix login bug", description: "Users can't log in on Safari" });
    await request(app)
      .post(`/api/v1/issues/${issue1.body.issue.id}/labels`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ labelId: bugLabelId });

    // Issue 2: TODO, assigned to member, labeled "feature".
    const issue2 = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        title: "Add dark mode",
        description: "Users have requested a dark theme",
        status: "TODO",
        assigneeId: memberId,
      });
    await request(app)
      .post(`/api/v1/issues/${issue2.body.issue.id}/labels`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ labelId: featureLabelId });

    // Issue 3: IN_PROGRESS, no description, unassigned, unlabeled.
    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Refactor auth module", status: "IN_PROGRESS" });

    // Issue 4: DONE, unassigned, unlabeled.
    await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        title: "Write onboarding docs",
        description: "Explain the signup flow",
        status: "DONE",
      });

    // A second, unrelated project with a *same-titled* issue -
    // proves search/filters never leak across project boundaries.
    const otherProject = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ name: "A different project entirely" });
    await request(app)
      .post(`/api/v1/projects/${otherProject.body.project.id}/issues`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ title: "Fix login bug" });
  });

  afterAll(async () => {
    const emails = [ownerEmail, memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  function titlesFrom(response: request.Response): string[] {
    return (response.body.issues as { title: string }[]).map((i) => i.title);
  }

  it("finds a title match, project-scoped (SRC-01) - not the other project's same-titled issue", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?search=login`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response)).toEqual(["Fix login bug"]);
  });

  it("is case-insensitive and matches the description too", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?search=USERS`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response).sort()).toEqual(["Add dark mode", "Fix login bug"]);
  });

  it("returns an empty list (200, not 404) for a search with no matches", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?search=nonexistentxyz`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issues).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
  });

  it("rejects an empty search term", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?search=`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(400);
  });

  it("filters by a single status", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?status=DONE`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response)).toEqual(["Write onboarding docs"]);
  });

  it("OR's multiple statuses within the same param (SRC-03)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?status=TODO,DONE`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response).sort()).toEqual(["Add dark mode", "Write onboarding docs"]);
  });

  it("rejects an invalid status value", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?status=NOT_A_REAL_STATUS`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(400);
  });

  it("filters by assignee", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?assigneeId=${memberId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response)).toEqual(["Add dark mode"]);
  });

  it("filters by a single label", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?labelId=${bugLabelId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response)).toEqual(["Fix login bug"]);
  });

  it("OR's multiple labels within the same param (SRC-03)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?labelId=${bugLabelId},${featureLabelId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response).sort()).toEqual(["Add dark mode", "Fix login bug"]);
  });

  it("ANDs different filter params together (SRC-03) - status that matches AND assignee that matches", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?status=TODO&assigneeId=${memberId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response)).toEqual(["Add dark mode"]);
  });

  it("returns nothing when AND'd filters don't share a common issue", async () => {
    // Issue 1 is BACKLOG+bug, issue 2 is TODO+feature - no single
    // issue is both BACKLOG *and* labeled "feature". If this were
    // mistakenly OR'd across params instead of AND'd, both would come
    // back.
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?status=BACKLOG&labelId=${featureLabelId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issues).toEqual([]);
  });

  it("combines search with a filter (AND)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?search=users&status=TODO`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(titlesFrom(response)).toEqual(["Add dark mode"]);
  });

  it("reports pagination.total against the filtered count, not the whole project", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?status=DONE`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(response.body.pagination.total).toBe(1);
  });

  it("returns 404 for a non-member even with search/filter params present (D-06)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/issues?search=login`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(response.status).toBe(404);
  });
});
