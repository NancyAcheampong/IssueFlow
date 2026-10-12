import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { authRateLimit } from "../../middleware/authRateLimit.js";
import { createUserSchema } from "./adminUsers.schemas.js";
import { createUser, listAllUsers } from "./adminUsers.service.js";

// Mounted at /api/v1/admin/users. IssueFlow has no public signup (Oct
// 12) - every account, including the first one after the seeded ADMIN,
// is provisioned here instead, by someone who's already an ADMIN.
export const adminUsersRouter = Router();

// POST /api/v1/admin/users - replaces the old public POST /auth/signup.
// Still rate-limited (same shared authRateLimit as login) - account
// creation is worth throttling even gated behind admin auth, same
// defense-in-depth reasoning as before.
adminUsersRouter.post(
  "/",
  requireAuth,
  requireAdmin,
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await createUser(input);
    res.status(201).json({ user });
  }),
);

// GET /api/v1/admin/users - admin-only roster, so the admin has
// somewhere to see who already has an account.
adminUsersRouter.get(
  "/",
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const users = await listAllUsers();
    res.status(200).json({ users });
  }),
);
