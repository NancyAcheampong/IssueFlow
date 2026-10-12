import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { signAccessToken } from "../../lib/jwt.js";
import { authRateLimit } from "../../middleware/authRateLimit.js";
import { loginSchema } from "./auth.schemas.js";
import { verifyCredentials } from "./auth.service.js";

export const authRouter = Router();

// POST /api/v1/auth/signup removed (Oct 12) - IssueFlow is an internal
// workplace tool, not a public sign-up-yourself product. Account
// creation moved to POST /api/v1/admin/users (modules/admin), which
// only an ADMIN can call. The seeded admin account (lib/seedAdmin.ts)
// provisions every other account from there.

// POST /api/v1/auth/login - AUTH-02. Verifies credentials, then issues
// the access token as part of the response body (not a cookie) - the
// spec's guiding principle is to keep the API clean for a future mobile
// client, and a bearer token in an Authorization header works the same
// way for a browser and a mobile app, where cookies don't travel as
// naturally. Rate-limited (Oct 6 security review) - the actual
// password-guessing surface.
authRouter.post(
  "/login",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await verifyCredentials(input.email, input.password);
    const token = signAccessToken({ sub: user.id });
    res.status(200).json({ user, token });
  }),
);
