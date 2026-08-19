import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { signAccessToken } from "../../lib/jwt.js";
import { loginSchema, signupSchema } from "./auth.schemas.js";
import { createUser, verifyCredentials } from "./auth.service.js";

export const authRouter = Router();

// POST /api/v1/auth/signup - AUTH-01. Deliberately does not issue a JWT -
// signup and "start a session" stay two separate, independently testable
// steps (D-02 in the spec). The client calls /login next.
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const input = signupSchema.parse(req.body);
    const user = await createUser(input);
    res.status(201).json({ user });
  }),
);

// POST /api/v1/auth/login - AUTH-02. Verifies credentials, then issues
// the access token as part of the response body (not a cookie) - the
// spec's guiding principle is to keep the API clean for a future mobile
// client, and a bearer token in an Authorization header works the same
// way for a browser and a mobile app, where cookies don't travel as
// naturally.
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await verifyCredentials(input.email, input.password);
    const token = signAccessToken({ sub: user.id });
    res.status(200).json({ user, token });
  }),
);
