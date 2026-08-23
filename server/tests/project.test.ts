import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// Integration test against a real database - proving the Project /
// ProjectMembership migration actually enforces what we designed:
// the composite primary key, cascading deletes, and the owner+membership
// pattern PRJ-01 requires (creator becomes owner AND first member).
describe("Project + ProjectMembership", () => {
  const testEmail = `project-model-test-${Date.now()}@example.com`;
  let userId: string;

  afterAll(async () => {
    // Deleting the user cascades to their memberships (see schema), but
    // projects they own use ON DELETE RESTRICT - so any project created
    // in these tests needs to be deleted explicitly first, or this
    // cleanup itself would fail.
    await prisma.project.deleteMany({ where: { owner: { email: testEmail } } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  it("creates a project and an owner membership together (PRJ-01)", async () => {
    const user = await prisma.user.create({
      data: { email: testEmail, displayName: "Project Test Owner", passwordHash: "placeholder" },
    });
    userId = user.id;

    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        description: "A project created for testing",
        ownerId: userId,
        memberships: {
          create: { userId, role: "OWNER" },
        },
      },
      include: { memberships: true },
    });

    expect(project.ownerId).toBe(userId);
    expect(project.memberships).toHaveLength(1);
    expect(project.memberships[0]).toMatchObject({ userId, role: "OWNER" });
  });

  it("rejects a duplicate membership for the same user in the same project", async () => {
    const project = await prisma.project.findFirstOrThrow({ where: { ownerId: userId } });

    await expect(
      prisma.projectMembership.create({
        data: { projectId: project.id, userId, role: "MEMBER" },
      }),
    ).rejects.toThrow();
  });

  it("cascades: deleting a project removes its membership rows too", async () => {
    const project = await prisma.project.findFirstOrThrow({ where: { ownerId: userId } });
    const projectId = project.id;

    await prisma.project.delete({ where: { id: projectId } });

    const remainingMemberships = await prisma.projectMembership.findMany({ where: { projectId } });
    expect(remainingMemberships).toHaveLength(0);
  });
});
