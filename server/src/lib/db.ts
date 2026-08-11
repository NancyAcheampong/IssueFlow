import { Pool } from "pg";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// Phase 0 only needs to prove the server can reach Postgres at all, so we
// use `pg` directly here rather than Prisma. Prisma's client is generated
// from the schema's models, and we don't have any real tables yet — those
// arrive in Phase 1 alongside the first migration (User), at which point
// Prisma becomes the query layer for actual domain logic. This pool stays
// around afterward too, for the odd raw-SQL health/readiness check.
export const pool = new Pool({ connectionString: env.DATABASE_URL });

// pg emits 'error' on the pool when an *idle* client's connection dies
// (e.g. the database restarts or drops the connection). Node treats an
// EventEmitter 'error' with no listener as fatal and crashes the whole
// process - so without this handler, a blip in the database takes the
// entire API down with it, instead of just making pingDatabase() report
// unhealthy like it's supposed to. This is what /api/v1/status exists
// for: the server should survive a dead database and say so, not die.
pool.on("error", (err) => {
  logger.error({ err }, "unexpected error on idle database client");
});

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
