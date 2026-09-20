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
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .send({ title: "No auth" });
    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/projects/:projectId/issues", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `list-issues-member-${runId}@example.com`;
  const outsiderEmail = `list-issues-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let projectAId: string;
  let projectBId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "List Issues Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "List Issues Outsider");
    outsiderToken = outsider.token;

    const projectA = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "List Issues Project A" });
    projectAId = projectA.body.project.id;

    const projectB = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ name: "List Issues Project B" });
    projectBId = projectB.body.project.id;

    await request(app)
      .post(`/api/v1/projects/${projectAId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "A - first" });
    await request(app)
      .post(`/api/v1/projects/${projectAId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "A - second" });
    await request(app)
      .post(`/api/v1/projects/${projectBId}/issues`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ title: "B - unrelated" });
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("lists only the requested project's issues, in number order, and never another project's", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectAId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    const titles = (response.body.issues as { title: string; number: number }[]).map(
      (i) => i.title,
    );
    expect(titles).toEqual(["A - first", "A - second"]);
    expect(titles).not.toContain("B - unrelated");
  });

  it("returns 404 for a project the requester has no membership in (D-06)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectBId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app).get(`/api/v1/projects/${projectAId}/issues`);
    expect(response.status).toBe(401);
  });

  it("defaults to page 1 of 25 and reports accurate pagination metadata (ISS-07)", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectAId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 1, pageSize: 25, total: 2, totalPages: 1 });
  });

  it("honors page and pageSize query params", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectAId}/issues?page=2&pageSize=1`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issues).toHaveLength(1);
    expect(response.body.issues[0].title).toBe("A - second");
    expect(response.body.pagination).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
  });

  it("rejects an invalid page number", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectAId}/issues?page=0`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(400);
  });

  it("rejects a pageSize above the cap", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectAId}/issues?pageSize=101`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(400);
  });
});

describe("GET /api/v1/issues/:issueId", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `issue-detail-member-${runId}@example.com`;
  const outsiderEmail = `issue-detail-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let issueId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Issue Detail Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "Issue Detail Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Issue Detail Test Project" });

    const issueResponse = await request(app)
      .post(`/api/v1/projects/${project.body.project.id}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Detail test issue", description: "Some detail" });
    issueId = issueResponse.body.issue.id;
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("returns full issue detail, including its board placement, for a project member (ISS-03)", async () => {
    const response = await request(app)
      .get(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issue).toMatchObject({
      title: "Detail test issue",
      description: "Some detail",
    });
    expect(response.body.issue.boardPlacement).toBeTruthy();
  });

  it("returns 404 for someone with no membership in the issue's project (D-06)", async () => {
    const response = await request(app)
      .get(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(response.status).toBe(404);
  });

  it("returns 404 for an issue id that doesn't exist at all", async () => {
    const response = await request(app)
      .get("/api/v1/issues/not-a-real-issue-id")
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app).get(`/api/v1/issues/${issueId}`);
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/v1/issues/:issueId", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `edit-issue-member-${runId}@example.com`;
  const otherMemberEmail = `edit-issue-other-member-${runId}@example.com`;
  const outsiderEmail = `edit-issue-outsider-${runId}@example.com`;
  let memberToken: string;
  let otherMemberId: string;
  let outsiderToken: string;
  let issueId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Edit Issue Member");
    memberToken = member.token;
    const otherMember = await signupAndLogin(app, otherMemberEmail, "Edit Issue Other Member");
    otherMemberId = otherMember.userId;
    const outsider = await signupAndLogin(app, outsiderEmail, "Edit Issue Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Edit Issue Test Project" });
    const projectId = project.body.project.id as string;

    await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ email: otherMemberEmail });

    const issueResponse = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Original title", description: "Original description" });
    issueId = issueResponse.body.issue.id;
  });

  afterAll(async () => {
    const emails = [memberEmail, otherMemberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("lets a project member edit the title, leaving other fields untouched (ISS-04)", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Updated title" });

    expect(response.status).toBe(200);
    expect(response.body.issue).toMatchObject({
      title: "Updated title",
      description: "Original description",
    });
  });

  it("assigns the issue to a valid project member (ASN-02)", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ assigneeId: otherMemberId });

    expect(response.status).toBe(200);
    expect(response.body.issue.assigneeId).toBe(otherMemberId);
  });

  it("unassigns the issue with an explicit null assigneeId", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ assigneeId: null });

    expect(response.status).toBe(200);
    expect(response.body.issue.assigneeId).toBeNull();
  });

  it("clears the description with an explicit empty string", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ description: "" });

    expect(response.status).toBe(200);
    expect(response.body.issue.description).toBeNull();
  });

  it("rejects an assignee who isn't a current project member (ASN-02)", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ assigneeId: "not-a-real-member-id" });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.assigneeId).toBeDefined();
  });

  it("rejects an empty title", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "" });

    expect(response.status).toBe(400);
  });

  it("rejects a patch with no fields at all", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it("returns 404 for someone with no membership in the issue's project (D-06)", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ title: "Should not apply" });

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${issueId}`)
      .send({ title: "No auth" });
    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/issues/:issueId/close and /reopen", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `close-issue-member-${runId}@example.com`;
  const outsiderEmail = `close-issue-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let issueId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Close Issue Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "Close Issue Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Close Issue Test Project" });

    const issueResponse = await request(app)
      .post(`/api/v1/projects/${project.body.project.id}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Close/reopen test issue" });
    issueId = issueResponse.body.issue.id;
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("closes an issue by setting status to DONE (ISS-05)", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/close`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issue.status).toBe("DONE");
  });

  it("is idempotent - closing an already-closed issue is a 200 no-op", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/close`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issue.status).toBe("DONE");
  });

  it("reopens an issue by setting status to BACKLOG (ISS-05)", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/reopen`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issue.status).toBe("BACKLOG");
  });

  it("is idempotent - reopening an already-open issue is a 200 no-op", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/reopen`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body.issue.status).toBe("BACKLOG");
  });

  it("returns 404 for someone with no membership in the issue's project on close (D-06)", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/close`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(response.status).toBe(404);
  });

  it("requires authentication on close", async () => {
    const response = await request(app).post(`/api/v1/issues/${issueId}/close`);
    expect(response.status).toBe(401);
  });

  it("requires authentication on reopen", async () => {
    const response = await request(app).post(`/api/v1/issues/${issueId}/reopen`);
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/v1/issues/:issueId/move", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `move-issue-member-${runId}@example.com`;
  const outsiderEmail = `move-issue-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let projectId: string;
  let cardAId: string;
  let cardBId: string;
  let cardCId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Move Issue Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "Move Issue Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Move Issue Test Project" });
    projectId = project.body.project.id;

    // Three BACKLOG cards, created in order: A, B, C.
    const a = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Card A" });
    cardAId = a.body.issue.id;
    const b = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Card B" });
    cardBId = b.body.issue.id;
    const c = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Card C" });
    cardCId = c.body.issue.id;
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  interface BoardCard {
    id: string;
    title: string;
    boardPlacement: { version: number };
  }

  async function getBoard(): Promise<Record<string, BoardCard[]>> {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/board`)
      .set("Authorization", `Bearer ${memberToken}`);
    return response.body.board as Record<string, BoardCard[]>;
  }

  it("reorders card C between A and B within the same column", async () => {
    const cardC = (await getBoard()).BACKLOG[2];
    const response = await request(app)
      .patch(`/api/v1/issues/${cardCId}/move`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({
        prevIssueId: cardAId,
        nextIssueId: cardBId,
        version: cardC?.boardPlacement.version ?? 0,
      });

    expect(response.status).toBe(200);

    const board = await getBoard();
    const titles = board.BACKLOG.map((i) => i.title);
    expect(titles).toEqual(["Card A", "Card C", "Card B"]);
  });

  it("moves a card into a different status column, updating status and position atomically", async () => {
    const boardBefore = await getBoard();
    const cardB = boardBefore.BACKLOG.find((i) => i.id === cardBId);

    const response = await request(app)
      .patch(`/api/v1/issues/${cardBId}/move`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ status: "TODO", version: cardB?.boardPlacement.version ?? 0 });

    expect(response.status).toBe(200);
    expect(response.body.issue.status).toBe("TODO");

    const boardAfter = await getBoard();
    expect(boardAfter.BACKLOG.map((i) => i.id)).not.toContain(cardBId);
    expect(boardAfter.TODO.map((i) => i.id)).toContain(cardBId);
  });

  it("rejects a move with a stale version (optimistic concurrency)", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${cardAId}/move`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ version: 999 });

    expect(response.status).toBe(409);
  });

  it("leaves status untouched if the stale-version move is rejected (one transaction, D-20)", async () => {
    const before = await request(app)
      .get(`/api/v1/issues/${cardAId}`)
      .set("Authorization", `Bearer ${memberToken}`);

    await request(app)
      .patch(`/api/v1/issues/${cardAId}/move`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ status: "DONE", version: 999 });

    const after = await request(app)
      .get(`/api/v1/issues/${cardAId}`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(after.body.issue.status).toBe(before.body.issue.status);
  });

  it("rejects a prevIssueId/nextIssueId that belongs to a different project", async () => {
    const otherProject = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "A different project entirely" });
    const otherIssue = await request(app)
      .post(`/api/v1/projects/${otherProject.body.project.id}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Issue in a different project" });

    const response = await request(app)
      .patch(`/api/v1/issues/${cardAId}/move`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ prevIssueId: otherIssue.body.issue.id, version: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.fields.prevIssueId).toBeDefined();
  });

  it("returns 404 for someone with no membership in the issue's project (D-06)", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${cardAId}/move`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ version: 0 });

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .patch(`/api/v1/issues/${cardAId}/move`)
      .send({ version: 0 });
    expect(response.status).toBe(401);
  });
});
