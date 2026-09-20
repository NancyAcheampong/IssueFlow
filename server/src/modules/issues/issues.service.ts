import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import { rankBetween } from "../../lib/rank.js";
import type {
  CreateIssueInput,
  ListIssuesQuery,
  MoveIssueInput,
  UpdateIssueInput,
} from "./issues.schemas.js";

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

  // D-19 (resolves D-03/D-12): new cards go to the bottom of their
  // starting column - ranked after whatever currently has the highest
  // rank among issues already in that (project, status) column, or
  // first-in-column if it's empty. Not a global "last created" rank:
  // a new BACKLOG card shouldn't jump ranks with unrelated DONE cards
  // just because they were created more recently.
  const status = input.status ?? "BACKLOG";
  const lastInColumn = await prisma.boardPlacement.findFirst({
    where: { projectId, issue: { status } },
    orderBy: { rank: "desc" },
  });
  const rank = rankBetween(lastInColumn?.rank, null);

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
    data.assignee =
      input.assigneeId === null ? { disconnect: true } : { connect: { id: input.assigneeId } };
  }

  return prisma.issue.update({
    where: { id: issueId },
    data,
    include: { boardPlacement: true },
  });
}

// ISS-05: close/reopen as their own dedicated actions rather than a
// generic "PATCH status" field (see DECISIONS.md D-14 for why, and why
// PATCH /:issueId (ISS-04, above) deliberately excludes status). Both
// are idempotent - closing an already-closed issue or reopening an
// already-open one is a no-op 200, not an error, matching how GitHub's
// own close/reopen behave. "Closed" is modeled as status DONE; there's
// no separate boolean column - see D-14.
export async function closeIssue(issueId: string) {
  return prisma.issue.update({
    where: { id: issueId },
    data: { status: "DONE" },
    include: { boardPlacement: true },
  });
}

// Reopens to BACKLOG, not whatever status the issue held before it was
// closed - the schema doesn't record prior status (there's no history
// table for it), and BACKLOG is the correct "needs triage again" state
// for a reopened issue. See D-14.
export async function reopenIssue(issueId: string) {
  return prisma.issue.update({
    where: { id: issueId },
    data: { status: "BACKLOG" },
    include: { boardPlacement: true },
  });
}

// Phase 4/D-19/D-20: a neighbor card referenced in a move request must
// have a placement in the *same project* - the same cross-project
// rejection already applied to assigneeId (ASN-02), comment parentId
// (D-16), and label attachment (D-18). A 400, not 404: the id came
// from the caller's own request body.
async function getPlacementInProject(
  issueId: string,
  projectId: string,
  fieldName: "prevIssueId" | "nextIssueId",
) {
  const placement = await prisma.boardPlacement.findUnique({ where: { issueId } });

  if (!placement || placement.projectId !== projectId) {
    throw AppError.badRequest("A neighbor card must belong to this same project.", {
      [fieldName]: "Not a card in this project.",
    });
  }

  return placement;
}

// Phase 4 (Day 39-ish)/D-20: moves a card - status and rank change
// together in one transaction, so a move is never observable as "status
// changed but still in its old board position" or vice versa. Guarded
// by optimistic concurrency on BoardPlacement.version: if the version
// the caller sent doesn't match what's actually in the database (this
// card moved again since the caller last fetched the board), the
// entire transaction rolls back - the status update included, even
// though status isn't what conflicted - and a 409 comes back instead
// of silently clobbering a concurrent move. See DECISIONS.md D-20.
export async function moveIssue(issueId: string, projectId: string, input: MoveIssueInput) {
  const [prevPlacement, nextPlacement] = await Promise.all([
    input.prevIssueId ? getPlacementInProject(input.prevIssueId, projectId, "prevIssueId") : null,
    input.nextIssueId ? getPlacementInProject(input.nextIssueId, projectId, "nextIssueId") : null,
  ]);

  const rank = rankBetween(prevPlacement?.rank, nextPlacement?.rank);

  return prisma.$transaction(async (tx) => {
    if (input.status) {
      await tx.issue.update({ where: { id: issueId }, data: { status: input.status } });
    }

    const result = await tx.boardPlacement.updateMany({
      where: { issueId, version: input.version },
      data: { rank, version: { increment: 1 } },
    });

    if (result.count === 0) {
      throw AppError.conflict("This card was moved by someone else. Refresh and try again.");
    }

    return tx.issue.findUniqueOrThrow({
      where: { id: issueId },
      include: { boardPlacement: true },
    });
  });
}

// ISS-07: per-project listing, ordered by issue number, offset-paginated.
// Keyword search and filters are still Phase 6 (SRC-*) - not here yet.
// Two queries (count + page) rather than one - simplest correct thing,
// and this table has nowhere near the volume where that split matters.
export async function listIssuesForProject(projectId: string, query: ListIssuesQuery) {
  const { page, pageSize } = query;

  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where: { projectId },
      orderBy: { number: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.issue.count({ where: { projectId } }),
  ]);

  return {
    issues,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}
