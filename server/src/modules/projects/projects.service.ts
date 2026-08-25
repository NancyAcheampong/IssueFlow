import { prisma } from "../../lib/prisma.js";
import type { CreateProjectInput } from "./projects.schemas.js";

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
