import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";

// One shared PrismaClient for the whole process. Prisma manages its own
// connection pool internally, so creating more than one instance per
// process just wastes connections rather than helping anything.
//
// This is the query layer for actual domain logic (users, projects,
// issues, ...) going forward. The raw `pg` pool in db.ts stays around
// too, but only for the liveness/readiness check - it predates this
// file and there's no reason to route a trivial `SELECT 1` through the
// heavier Prisma client.
export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "warn" },
    { emit: "event", level: "error" },
  ],
});

prisma.$on("warn", (event) => logger.warn({ prisma: event }, "prisma warning"));
prisma.$on("error", (event) => logger.error({ prisma: event }, "prisma error"));

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
