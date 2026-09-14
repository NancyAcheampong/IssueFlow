import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import type { CreateIssueInput, UpdateIssueInput } from "./issues.schemas.js";

// ASN-02: an issue's assignee must be a current member of the same
// project. Needs a DB lookup, so it's checked here rather than in the
// zod schema (which can only validate the shape of the input, not
// whether it refers to something real). Exported - reused as-is by
// updateIssue below, since reassigning obeys the identical rule as
// assigning at creation.
export async function assertAssigneeIsMember(projectId: string, assigneeId: string): Promise<void> {
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

// ISS-03: any project member can view an issue's full detail. This
// route isn't nested under /projects/:projectId (it's just
// /issues/:issueId), so authorization runs backwards from the other
// routes in this module: look the issue up first to find which
// project it belongs to, then apply the same D-06 policy - no
// membership in that project means the same 404 as if the issue
// didn't exist at all.
export async function getIssueById(issueId: string, userId: string) {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    include: { boardPlacement: true },
  });

  if (!issue) {
    throw AppError.notFound("Issue not found.");
  }

  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId: issue.projectId, userId } },
  });
  if (!membership) {
    throw AppError.notFound("Issue not found.");
  }

  return issue;
}

// ISS-04: any project member can edit title/description/assignee.
// Caller already knows both issueId and the issue's projectId (from
// getIssueById in the route) - no need to re-fetch either here.
// Only the fields actually present in the input get written -
// `undefined` means "leave alone," matching updateProject's convention
// for description, and extended to assigneeId as documented in
// issues.schemas.ts.
export async function updateIssue(issueId: string, projectId: string, input: UpdateIssueInput) {
  if (input.assigneeId) {
    await assertAssigneeIsMember(projectId, input.assigneeId);
  }

  const data: Prisma.IssueUpdateInput = {};

  if (input.title !== undefined) {
    data.title = input.title;
  }
  if (input.description !== undefined) {
    data.description = input.description === "" ? null : input.description;
  }
  if (input.assigneeId !== undefined) {
    data.assignee = input.assigneeId === null ? { disconnect: true } : { connect: { id: input.assigneeId } };
  }

  return prisma.issue.update({
    where: { id: issueId },
    data,
    include: { boardPlacement: true },
  });
}

// Plain per-project listing, ordered by issue number. Keyword search
// and filters are Phase 6 (SRC-*); pagination is ISS-07 (P1, later
// this phase) - both deliberately not here yet.
export async function listIssuesForProject(projectId: string) {
  return prisma.issue.findMany({
    where: { projectId },
    orderBy: { number: "asc" },
  });
}
