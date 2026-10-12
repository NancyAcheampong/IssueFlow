import bcrypt from "bcrypt";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// Same cost factor as modules/admin/adminUsers.service.ts - duplicated
// rather than imported because this isn't really "using the create-user
// business function" (it's an idempotent upsert-like check, not an
// insert-and-catch-the-conflict), just the same bcrypt tradeoff.
const BCRYPT_COST_FACTOR = 12;

// Called once from index.ts, before the server starts accepting
// requests (Oct 12): IssueFlow has no public signup, so there has to be
// *some* way to get the very first account into a fresh database.
// Idempotent and safe to run on every restart - if ADMIN_EMAIL already
// has an account, this only makes sure its role is ADMIN and otherwise
// leaves it alone. It deliberately does NOT re-hash and overwrite the
// password on every restart: if it did, an admin who'd changed their
// password (once that feature exists) would get silently logged out of
// their real password back to whatever's in .env every time the server
// restarts - surprising and not what ADMIN_PASSWORD is for (it's an
// *initial* password, same as any admin-provisioned account's).
export async function ensureAdminUser(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL } });

  if (existing) {
    if (existing.role !== "ADMIN") {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
      logger.info(`Promoted existing account ${env.ADMIN_EMAIL} to ADMIN`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, BCRYPT_COST_FACTOR);
  await prisma.user.create({
    data: {
      email: env.ADMIN_EMAIL,
      displayName: "Admin",
      passwordHash,
      role: "ADMIN",
    },
  });
  logger.info(`Seeded admin account ${env.ADMIN_EMAIL}`);
}
