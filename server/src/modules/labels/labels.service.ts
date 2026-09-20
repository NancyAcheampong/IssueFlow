import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import type { CreateLabelInput } from "./labels.schemas.js";

// LBL-01: any project member can create a label - collaborative
// classification metadata, not a project-settings change, so this is
// member-level (no requireOwnerRole gate), same reasoning as issue
// creation itself.
export async function createLabel(projectId: string, input: CreateLabelInput) {
  try {
    return await prisma.label.create({
      data: { projectId, name: input.name, color: input.color },
    });
  } catch (err) {
    // Same race-condition-safe pattern as duplicate email/membership
    // (D-09/D-11): attempt the insert, let the (projectId, name)
    // unique constraint be the actual source of truth.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A label with that name already exists in this project.");
    }
    throw err;
  }
}

export async function listLabelsForProject(projectId: string) {
  return prisma.label.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
}

// LBL-01: deleting a label the project doesn't actually have (a
// mismatched id, possibly belonging to a different project entirely)
// is a 404, not a silent success - `deleteMany` scoped to
// (id, projectId) together is what makes that cross-project case
// impossible to hit by accident.
export async function deleteLabel(projectId: string, labelId: string): Promise<void> {
  const result = await prisma.label.deleteMany({ where: { id: labelId, projectId } });

  if (result.count === 0) {
    throw AppError.notFound("Label not found in this project.");
  }
}

// LBL-02: a label can only be attached to an issue in *its own*
// project - the Phase 3 exit gate's "cross-project references are
// rejected" applies to labels exactly as it does to assignees
// (ASN-02) and comment parents (COM-03). A 400, not 404: the caller
// supplied a labelId as part of their own request body, so a mismatch
// is a bad request, the same treatment as an invalid assigneeId.
async function assertLabelBelongsToProject(projectId: string, labelId: string): Promise<void> {
  const label = await prisma.label.findUnique({ where: { id: labelId } });

  if (!label || label.projectId !== projectId) {
    throw AppError.badRequest("That label does not belong to this issue's project.", {
      labelId: "Not a label in this project.",
    });
  }
}

export async function attachLabelToIssue(issueId: string, projectId: string, labelId: string) {
  await assertLabelBelongsToProject(projectId, labelId);

  try {
    await prisma.issueLabel.create({ data: { issueId, labelId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("That label is already attached to this issue.");
    }
    throw err;
  }

  return listLabelsForIssue(issueId);
}

export async function detachLabelFromIssue(issueId: string, labelId: string): Promise<void> {
  const result = await prisma.issueLabel.deleteMany({ where: { issueId, labelId } });

  if (result.count === 0) {
    throw AppError.notFound("That label is not attached to this issue.");
  }
}

export async function listLabelsForIssue(issueId: string) {
  const issueLabels = await prisma.issueLabel.findMany({
    where: { issueId },
    include: { label: true },
    orderBy: { label: { name: "asc" } },
  });

  return issueLabels.map((issueLabel) => issueLabel.label);
}
