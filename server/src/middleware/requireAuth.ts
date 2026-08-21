import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt.js";
import { AppError } from "../lib/AppError.js";

// AUTH-04: every protected route must reject missing/invalid auth with
// 401. This only verifies the token's signature and expiry and pulls the
// user id out of it - it deliberately does NOT hit the database on every
// request. A route that just needs to know *who's asking* (most of them)
// uses req.userId directly, for free. A route that actually needs the
// user's current data (like GET /me) looks it up itself - that's a
// choice each route makes, not something forced on all of them here.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    next(AppError.unauthorized());
    return;
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    // Covers both a malformed/invalid signature and an expired token -
    // AUTH-04 doesn't distinguish between them, both are just "not
    // authenticated," and the caller doesn't need to know which.
    next(AppError.unauthorized());
  }
}
