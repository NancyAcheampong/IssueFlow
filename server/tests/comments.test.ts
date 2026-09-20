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

describe("POST /api/v1/issues/:issueId/comments", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `comment-member-${runId}@example.com`;
  const otherMemberEmail = `comment-other-member-${runId}@example.com`;
  const outsiderEmail = `comment-outsider-${runId}@example.com`;
  let memberToken: string;
  let otherMemberId: string;
  let outsiderToken: string;
  let issueId: string;
  let otherIssueId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "Comment Member");
    memberToken = member.token;
    const otherMember = await signupAndLogin(app, otherMemberEmail, "Comment Other Member");
    otherMemberId = otherMember.userId;
    const outsider = await signupAndLogin(app, outsiderEmail, "Comment Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Comment Test Project" });
    const projectId = project.body.project.id as string;

    await request(app)
      .post(`/api/v1/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ email: otherMemberEmail });

    const issueResponse = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Comment test issue" });
    issueId = issueResponse.body.issue.id;

    const otherIssueResponse = await request(app)
      .post(`/api/v1/projects/${projectId}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "A different issue in the same project" });
    otherIssueId = otherIssueResponse.body.issue.id;
  });

  afterAll(async () => {
    const emails = [memberEmail, otherMemberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("lets a project member post a top-level comment (COM-01/COM-02)", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/comments`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ bodyMarkdown: "This is **bold** and this is *italic*." });

    expect(response.status).toBe(201);
    expect(response.body.comment.bodyMarkdown).toBe("This is **bold** and this is *italic*.");
    expect(response.body.comment.bodyHtml).toContain("<strong>bold</strong>");
    expect(response.body.comment.bodyHtml).toContain("<em>italic</em>");
    expect(response.body.comment.parentId).toBeNull();
  });

  it("rejects an empty comment body", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/comments`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ bodyMarkdown: "" });

    expect(response.status).toBe(400);
  });

  it("returns 404 for someone with no membership in the issue's project (D-06)", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/comments`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ bodyMarkdown: "Should not be created" });

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .post(`/api/v1/issues/${issueId}/comments`)
      .send({ bodyMarkdown: "No auth" });
    expect(response.status).toBe(401);
  });

  describe("threaded replies (COM-03)", () => {
    let parentCommentId: string;

    beforeAll(async () => {
      const parent = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "Parent comment" });
      parentCommentId = parent.body.comment.id;
    });

    it("lets another member reply to a comment via parentId", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "A reply", parentId: parentCommentId });

      expect(response.status).toBe(201);
      expect(response.body.comment.parentId).toBe(parentCommentId);
    });

    it("rejects a parentId that doesn't exist at all", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "Orphan reply", parentId: "not-a-real-comment-id" });

      expect(response.status).toBe(400);
      expect(response.body.error.fields.parentId).toBeDefined();
    });

    it("rejects a parentId that belongs to a different issue (COM-03)", async () => {
      const otherIssueComment = await request(app)
        .post(`/api/v1/issues/${otherIssueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "Comment on the other issue" });

      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          bodyMarkdown: "Cross-issue reply attempt",
          parentId: otherIssueComment.body.comment.id,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.fields.parentId).toBeDefined();
    });
  });

  describe("XSS sanitization (D-15)", () => {
    it("strips a raw <script> tag entirely from the rendered HTML", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "Hello <script>alert('xss')</script> world" });

      expect(response.status).toBe(201);
      expect(response.body.comment.bodyHtml).not.toContain("<script");
      expect(response.body.comment.bodyHtml).not.toContain("alert(");
    });

    it("strips an onerror handler from an <img> tag", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: '<img src="x" onerror="alert(1)">' });

      expect(response.status).toBe(201);
      expect(response.body.comment.bodyHtml).not.toContain("onerror");
      expect(response.body.comment.bodyHtml).not.toContain("<img");
    });

    it("strips a javascript: URL from a Markdown link", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "[click me](javascript:alert(1))" });

      expect(response.status).toBe(201);
      expect(response.body.comment.bodyHtml).not.toContain("javascript:");
    });

    it("keeps a plain https link intact", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "[docs](https://example.com/docs)" });

      expect(response.status).toBe(201);
      expect(response.body.comment.bodyHtml).toContain('href="https://example.com/docs"');
    });

    it("strips an <iframe> entirely", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: '<iframe src="https://evil.example"></iframe>' });

      expect(response.status).toBe(201);
      expect(response.body.comment.bodyHtml).not.toContain("<iframe");
    });
  });

  describe("@mention parsing (MEN-01)", () => {
    it("resolves a mention that matches a current project member's email local-part", async () => {
      const [localPart] = otherMemberEmail.split("@");
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: `Hey @${localPart}, take a look at this.` });

      expect(response.status).toBe(201);
      const mentionedUserIds = (response.body.comment.mentions as { userId: string }[]).map(
        (m) => m.userId,
      );
      expect(mentionedUserIds).toContain(otherMemberId);
    });

    it("silently ignores a mention token that doesn't match any project member", async () => {
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: "Hey @not-a-real-person, any thoughts?" });

      expect(response.status).toBe(201);
      expect(response.body.comment.mentions).toEqual([]);
    });

    it("does not resolve a mention matching someone outside the project (D-06 boundary)", async () => {
      const [localPart] = outsiderEmail.split("@");
      const response = await request(app)
        .post(`/api/v1/issues/${issueId}/comments`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ bodyMarkdown: `Hey @${localPart}` });

      expect(response.status).toBe(201);
      expect(response.body.comment.mentions).toEqual([]);
    });
  });
});

describe("GET /api/v1/issues/:issueId/comments", () => {
  const app = createApp();
  const runId = Date.now();
  const memberEmail = `list-comments-member-${runId}@example.com`;
  const outsiderEmail = `list-comments-outsider-${runId}@example.com`;
  let memberToken: string;
  let outsiderToken: string;
  let issueId: string;

  beforeAll(async () => {
    const member = await signupAndLogin(app, memberEmail, "List Comments Member");
    memberToken = member.token;
    const outsider = await signupAndLogin(app, outsiderEmail, "List Comments Outsider");
    outsiderToken = outsider.token;

    const project = await request(app)
      .post("/api/v1/projects")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "List Comments Test Project" });

    const issueResponse = await request(app)
      .post(`/api/v1/projects/${project.body.project.id}/issues`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "List comments test issue" });
    issueId = issueResponse.body.issue.id;

    await request(app)
      .post(`/api/v1/issues/${issueId}/comments`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ bodyMarkdown: "First" });
    await request(app)
      .post(`/api/v1/issues/${issueId}/comments`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ bodyMarkdown: "Second" });
  });

  afterAll(async () => {
    const emails = [memberEmail, outsiderEmail];
    await prisma.project.deleteMany({ where: { owner: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("lists comments oldest first", async () => {
    const response = await request(app)
      .get(`/api/v1/issues/${issueId}/comments`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    const bodies = (response.body.comments as { bodyMarkdown: string }[]).map(
      (c) => c.bodyMarkdown,
    );
    expect(bodies).toEqual(["First", "Second"]);
  });

  it("returns 404 for someone with no membership in the issue's project (D-06)", async () => {
    const response = await request(app)
      .get(`/api/v1/issues/${issueId}/comments`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app).get(`/api/v1/issues/${issueId}/comments`);
    expect(response.status).toBe(401);
  });
});
