import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { allowedOrigins } from "./config/env.js";
import { livenessRouter, readinessRouter } from "./modules/health/health.routes.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

export function createApp(): Express {
  const app = express();

  // Sets a handful of security-related headers (no sniffing, no framing,
  // etc.). Cheap to add, meaningfully reduces the default attack surface.
  app.use(helmet());

  // Only the configured frontend origin(s) may call this API from a
  // browser — see NFR-02 / the production checklist in the spec.
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );

  app.use(express.json());

  // Structured request logging (method, path, status, duration) for every
  // request, tagged with a request id so we can trace one request through
  // the logs even under concurrent load.
  app.use(pinoHttp({ logger }));

  app.use(livenessRouter);
  app.use("/api/v1", readinessRouter);

  // Future routers (auth, projects, issues, ...) get mounted here in
  // later phases, all under /api/v1.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
