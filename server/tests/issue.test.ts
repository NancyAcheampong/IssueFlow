import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// Integration test against a real database - proving the Issue /
// BoardPlacement migration actually enforces what we designed, not just
// that the schema file parses.
describe("Issue + BoardPlacement", () => {
  const testEmail = `issue-model-test-${Date.now()}@example.com`;
  let userId: string;
  let projectId: string;

  afterAll(async () => {
    // Deletion order matters given the FK constraints: issues before
    // the project (project_id is CASCADE, so this step is actually
    // optional, but explicit is clearer than relying on cascade here),
    // then the project (owner_id is RESTRICT), then the user.
    await prisma.project.deleteMany({ where: { owner: { email: testEmail } } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  it("creates an issue with a board placement together, using the project's number counter", async () => {
    const user = await prisma.user.create({
      data: { email: testEmail, displayName: "Issue Test Author", passwordHash: "placeholder" },
    });
    userId = user.id;

    const project = await prisma.project.create({
      data: {
        name: "Issue Test Project",
        ownerId: userId,
        memberships: { create: { userId, role: "OWNER" } },
      },
    });
    projectId = project.id;

    // Mirrors the atomic read-and-increment pattern the real create-issue
    // endpoint will use (Phase 2, later): claim the next number, then
    // create the issue + its placement in one nested write.
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: { nextIssueNumber: { increment: 1 } },
    });
    const issueNumber = updatedProject.nextIssueNumber - 1;

    const issue = await prisma.issue.create({
      data: {
        projectId,
        number: issueNumber,
        title: "First issue",
        authorId: userId,
        boardPlacement: {
          create: { projectId, rank: "a0" },
        },
      },
      include: { boardPlacement: true },
    });

    expect(issue.number).toBe(1);
    expect(issue.status).toBe("BACKLOG");
    expect(issue.boardPlacement).toMatchObject({ projectId, rank: "a0", version: 0 });
  });

  it("rejects a second issue with the same project + number pair (ISS-06)", async () => {
    await expect(
      prisma.issue.create({
        data: { projectId, number: 1, title: "Duplicate number", authorId: userId },
      }),
    ).rejects.toThrow();
  });

  it("cascades: deleting an issue removes its board placement too", async () => {
    const issue = await prisma.issue.findFirstOrThrow({ where: { projectId, number: 1 } });

    await prisma.issue.delete({ where: { id: issue.id } });

    const placement = await prisma.boardPlacement.findUnique({ where: { issueId: issue.id } });
    expect(placement).toBeNull();
  });

  it("cascades: deleting a project removes its issues too", async () => {
    const issue = await prisma.issue.create({
      data: {
        projectId,
        number: 2,
        title: "Second issue",
        authorId: userId,
        boardPlacement: { create: { projectId, rank: "a1" } },
      },
    });

    await prisma.project.delete({ where: { id: projectId } });

    const remainingIssue = await prisma.issue.findUnique({ where: { id: issue.id } });
    expect(remainingIssue).toBeNull();

    // Recreate for afterAll's cleanup query pattern (owner.email lookup)
    // to have nothing left to find - project is already gone, nothing
    // further to do here.
  });
});
