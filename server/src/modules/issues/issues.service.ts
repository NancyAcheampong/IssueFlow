import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import type { CreateIssueInput } from "./issues.schemas.js";

// ASN-02: an issue's assignee must be a current member of the same
// project. Needs a DB lookup, so it's checked here rather than in the
// zod schema (which can only validate the shape of the input, not
// whether it refers to something real).
async function assertAssigneeIsMember(projectId: string, assigneeId: string): Promise<void> {
  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId: assigneeId } },
  });

  if (!membership) {
    throw AppError.badRequest("Assignee must be a current member of this project.", {
      assigneeId: "Not a member of this project.",
    });
  }
}

// ISS-01: any project member (not owner-only) can create an issue.
// Creates the Issue and its BoardPlacement together in one nested
// write - same atomic pattern as Project+ProjectMembership (D-11), no
// window where an issue exists without a placement.
export async function createIssue(projectId: string, authorId: string, input: CreateIssueInput) {
  if (input.assigneeId) {
    await assertAssigneeIsMember(projectId, input.assigneeId);
  }

  // ISS-06 / D-12: atomically claim the next per-project issue number -
  // a single read-and-increment statement, not a racy SELECT MAX
  // followed by a separate insert (two concurrent creates could both
  // read the same max before either commits).
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: { nextIssueNumber: { increment: 1 } },
  });
  const number = updatedProject.nextIssueNumber - 1;

  // Placeholder rank: the current timestamp as a string. D-12/D-03: the
  // real ranking algorithm is Phase 4's decision (Day 33) - this only
  // needs to be valid input and roughly creation-ordered, since nothing
  // reorders cards yet to exercise anything more sophisticated.
  const rank = Date.now().toString();

  return prisma.issue.create({
    data: {
      projectId,
      number,
      title: input.title,
      description: input.description,
      status: input.status ?? "BACKLOG",
      authorId,
      assigneeId: input.assigneeId,
      boardPlacement: {
        create: { projectId, rank },
      },
    },
    include: { boardPlacement: true },
  });
}
