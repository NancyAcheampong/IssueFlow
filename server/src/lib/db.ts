import { Pool } from "pg";
import { env } from "../config/env.js";

// Phase 0 only needs to prove the server can reach Postgres at all, so we
// use `pg` directly here rather than Prisma. Prisma's client is generated
// from the schema's models, and we don't have any real tables yet — those
// arrive in Phase 1 alongside the first migration (User), at which point
// Prisma becomes the query layer for actual domain logic. This pool stays
// around afterward too, for the odd raw-SQL health/readiness check.
export const pool = new Pool({ connectionString: env.DATABASE_URL });

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabasePool(): Promise<void> {
  await pool.end();
}
