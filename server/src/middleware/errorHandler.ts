import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/AppError.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Any route that doesn't match anything falls through to here.
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

// Express recognizes an error-handling middleware by its four parameters
// specifically — it must stay (err, req, res, next) even though `next`
// is unused, or Express will treat it as a normal middleware and skip it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, fields: err.fields },
    });
    return;
  }

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      fields[issue.path.join(".") || "_"] = issue.message;
    }
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Request validation failed", fields },
    });
    return;
  }

  // Anything else is unexpected: log it with full detail server-side, but
  // never leak a stack trace or internal message to the client
  // (spec API-04 / NFR-07).
  logger.error({ err, path: req.originalUrl, method: req.method }, "unhandled error");

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: env.NODE_ENV === "production" ? "Something went wrong" : (err as Error)?.message,
    },
  });
}
