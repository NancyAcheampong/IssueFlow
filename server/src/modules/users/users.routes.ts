import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { getUserById } from "./users.service.js";

export const usersRouter = Router();

// GET /api/v1/me - the simplest possible protected route, and the first
// real proof that requireAuth works end to end: no token, wrong token,
// and a valid token all need to behave correctly here.
usersRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    // requireAuth guarantees this is set before this handler ever runs,
    // but checking defensively here avoids a non-null assertion and
    // keeps this route correct even if middleware ordering ever changes.
    if (!req.userId) {
      throw AppError.unauthorized();
    }

    const user = await getUserById(req.userId);
    res.status(200).json({ user });
  }),
);
