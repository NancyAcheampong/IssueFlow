import pino from "pino";
import { env } from "../config/env.js";

// One structured logger for the whole app. In development we pretty-print;
// in production we emit plain JSON lines so a log platform can parse them.
// NFR-07 requires errors to be logged with request context but never with
// secrets/stack traces leaking into API responses — this logger is for our
// own eyes (stdout), the HTTP error responses stay separate (see
// middleware/errorHandler.ts).
//
// Oct 9 ("finalize logging"): `redact` is what actually keeps that promise
// for *this* logger's own output, not just the HTTP response - pino-http
// (src/app.ts) logs every request's headers via pino's standard req
// serializer, which includes `Authorization` verbatim. Without this, every
// authenticated request wrote the caller's live bearer JWT to stdout in
// plain text - found live (Oct 9) by actually reading what a real
// authenticated request produced in the logs, not by reasoning about it in
// advance. Anyone with read access to logs (a log aggregator, a leaked log
// file, a misconfigured dashboard) could lift a still-valid token straight
// out of them and impersonate that session until it expires. `censor`
// replaces the value rather than deleting the key, so the shape of a log
// line stays consistent whether or not a request happened to carry auth.
// Exported separately (not just inlined below) so
// tests/logger.test.ts can build its own pino instance against this
// *exact* config - verifying the real thing, not a duplicated copy
// that could silently drift from what's actually running.
export const LOG_REDACT_CONFIG = {
  paths: ["req.headers.authorization", "req.headers.cookie"],
  censor: "[REDACTED]",
};

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: LOG_REDACT_CONFIG,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

