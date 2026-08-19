import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { signupSchema } from "./auth.schemas.js";
import { createUser } from "./auth.service.js";

export const authRouter = Router();

// POST /api/v1/auth/signup - AUTH-01. Login (AUTH-02) is tomorrow's task;
// signup deliberately does not issue a JWT here - the client is expected
// to call login next. That's a real design decision (D-02 in the spec),
// not an oversight: keeps "create an account" and "start a session"
// as two separate, individually-testable steps.
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const input = signupSchema.parse(req.body);
    const user = await createUser(input);
    res.status(201).json({ user });
  }),
);
