import { Router } from "express";
import { pingDatabase } from "../../lib/db.js";

// Liveness: "is the process up at all?" No dependencies checked — a
// deploy platform hits this to decide whether to keep routing traffic
// to this instance. Mounted at the bare root, not under /api/v1, since
// infra health checks are a platform concern, not an API resource.
export const livenessRouter = Router();

livenessRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness: "can the app actually do its job?" — proves we can reach
// Postgres. This is what Phase 0's exit gate means by "reaches the
// database." Lives under /api/v1 like every other resource (API-01).
export const readinessRouter = Router();

readinessRouter.get("/status", async (_req, res) => {
  const databaseReachable = await pingDatabase();

  if (databaseReachable) {
    res.status(200).json({ status: "ok", database: "reachable" });
  } else {
    res.status(503).json({ status: "degraded", database: "unreachable" });
  }
});
