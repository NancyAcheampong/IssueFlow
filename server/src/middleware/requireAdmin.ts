import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/AppError.js";

// Mounted after requireAuth on every admin-only route, so req.userId is
// always set by the time this runs. Unlike requireAuth's own check
// (lib/jwt.ts deliberately keeps the JWT payload to just `sub`, exactly
// so nothing in it can go stale), *this* check needs to reflect a role
// change immediately - a demoted admin shouldn't keep admin access for
// up to JWT_EXPIRES_IN just because their still-valid token predates the
// demotion. So it re-reads the role fresh from the database on every
// request rather than trusting a claim, the same "look it up when it
// actually matters" tradeoff GET /me already makes for user data
// generally (see requireAuth.ts's own comment) - admin-gated routes are
// low-volume enough that the extra query is cheap to afford.
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.userId) {
    next(AppError.unauthorized());
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { role: true },
  });

  if (!user || user.role !== "ADMIN") {
    next(AppError.forbidden("Admin access required."));
    return;
  }

  next();
}
