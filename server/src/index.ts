import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { closeDatabasePool } from "./lib/db.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`IssueFlow API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Close the HTTP server and the database connection cleanly on shutdown,
// instead of dropping in-flight requests and leaked connections. This is
// NFR-10 in the spec and matters especially on platforms like DigitalOcean
// App Platform that send SIGTERM before restarting/redeploying an instance.
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await closeDatabasePool();
    logger.info("Shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
