import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { closeDatabasePool } from "./lib/db.js";
import { disconnectPrisma } from "./lib/prisma.js";
import { attachRealtime } from "./realtime/socket.js";
import { ensureAdminUser } from "./lib/seedAdmin.js";

const app = createApp();

// Awaited before accepting traffic (Oct 12): IssueFlow has no public
// signup, so the seeded admin needs to exist before anyone could
// possibly log in to provision further accounts.
await ensureAdminUser();

const server = app.listen(env.PORT, () => {
  logger.info(`IssueFlow API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Phase 5/D-24: one HTTP server, one port - Socket.IO attaches to the
// same `server` Express is already listening on rather than standing
// up a second server/port to deploy and monitor separately.
attachRealtime(server);

// Close the HTTP server and the database connection cleanly on shutdown,
// instead of dropping in-flight requests and leaked connections. This is
// NFR-10 in the spec and matters especially on platforms like DigitalOcean
// App Platform that send SIGTERM before restarting/redeploying an instance.
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await closeDatabasePool();
    await disconnectPrisma();
    logger.info("Shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
