import pino from "pino";
import { env } from "../config/env.js";

// One structured logger for the whole app. In development we pretty-print;
// in production we emit plain JSON lines so a log platform can parse them.
// NFR-07 requires errors to be logged with request context but never with
// secrets/stack traces leaking into API responses — this logger is for our
// own eyes (stdout), the HTTP error responses stay separate (see
// middleware/errorHandler.ts).
export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});
