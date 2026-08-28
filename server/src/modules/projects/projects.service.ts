import { Prisma, type ProjectMembership } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import { toSafeUser, type SafeUser } from "../users/users.service.js";
import type { CreateProjectInput, UpdateProjectInput } from "./projects.schemas.js";

// PRJ-01: the creator becomes both the project's owner and its first
// member. A single nested Prisma write - both inserts happen in one
// implicit transaction, so there's no window where the project exists
// without its owner also being a member (see DECISIONS.md D-11: these
// are two places recording the same fact, kept in sync right here).
export async function createProject(ownerId: string, input: CreateProjectInput) {
  return prisma.project.create({
    data: {
      name: input.name,
      description: input.description,
      ownerId,
      memberships: {
        create: { userId: ownerId, role: "OWNER" },
      },
    },
  });
}

// PRJ-02: only projects the requester owns or belongs to. Every project
// owner is also a ProjectMembership row (see createProject above), so
// filtering on membership alone already covers owned projects too -
// no need to separately check ownerId.
export async function listProjectsForUser(userId: string) {
  return prisma.project.findMany({
    where: { memberships: { some: { userId } } },
    orderBy: { createdAt: "desc" },
  });
}

// Shared authorization check for every project-scoped route from here
// on: does this project exist, and is the requester actually a member
// of it? DECISIONS.md D-06: both "doesn't exist" and "exists but you're
// not in it" return the identical 404 - a non-member can't distinguish
// a real project ID they don't have access to from one that was never
// real at all.
export async function getProjectMembership(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { memberships: { where: { userId } } },
  });

  if (!project || project.memberships.length === 0) {
    throw AppError.notFound("Project not found.");
  }

  return { project, membership: project.memberships[0] as ProjectMembership };
}

// A distinct check from getProjectMembership on purpose: this is 403,
// not 404. The requester already cleared "is this even your project" -
// this is "does your role let you do *this specific thing*." Someone
// who legitimately knows the project exists doesn't need its existence
// hidden from them, just told they can't do this particular action.
export function requireOwnerRole(membership: { role: string }): void {
  if (membership.role !== "OWNER") {
    throw AppError.forbidden("Only the project owner can do this.");
  }
}

// PRJ-03: add an existing registered user as a member, identified by
// email (the identifier a project owner realistically has on hand for
// a colleague - not an internal user id).
export async function addMember(projectId: string, email: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { email } });

  // §7.2: "Unknown accounts produce a safe not-found result."
  if (!user) {
    throw AppError.notFound("No account found with that email.");
  }

  try {
    await prisma.projectMembership.create({
      data: { projectId, userId: user.id, role: "MEMBER" },
    });
  } catch (err) {
    // Same race-condition-safe pattern as duplicate-email signup
    // (DECISIONS.md D-09): attempt the insert, let the composite
    // primary key be the actual source of truth for "already a member."
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("That user is already a member of this project.");
    }
    throw err;
  }

  return toSafeUser(user);
}

// PRJ-04: owner removes a member. Two rules beyond "delete the row":
// the owner can't remove themselves (there's no ownership-transfer or
// project-deletion feature yet, so that would strand the project with
// no owner), and removing someone who isn't actually a member is a 404,
// not a silent success.
export async function removeMember(projectId: string, ownerId: string, targetUserId: string): Promise<void> {
  if (targetUserId === ownerId) {
    throw AppError.badRequest("The project owner can't remove themselves.");
  }

  const result = await prisma.projectMembership.deleteMany({
    where: { projectId, userId: targetUserId },
  });

  if (result.count === 0) {
    throw AppError.notFound("That user is not a member of this project.");
  }

  // PRJ-04: "the system safely handles any current assignment without
  // deleting historical authorship." Nothing to do here yet - Issue
  // (with its assigneeId) doesn't exist until later today's schema
  // work. Once it does, removing a member needs to unassign their
  // issues here rather than leave a dangling assigneeId; noting it now
  // so it isn't forgotten when Issue lands.
}

// PRJ-05: owner-only edit of name/description. Only the fields actually
// present in the input get written - `undefined` means "leave alone,"
// an explicit empty string means "clear it" (stored as null).
export async function updateProject(projectId: string, input: UpdateProjectInput) {
  const data: Prisma.ProjectUpdateInput = {};

  if (input.name !== undefined) {
    data.name = input.name;
  }
  if (input.description !== undefined) {
    data.description = input.description === "" ? null : input.description;
  }

  return prisma.project.update({ where: { id: projectId }, data });
}
