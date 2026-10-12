import { z } from "zod";

// signupSchema moved to modules/admin/adminUsers.schemas.ts as
// createUserSchema (Oct 12) - same shape, now an admin-only action.

// AUTH-02. No minimum-length check here on purpose: this isn't validating
// a *new* password against today's policy, it's just "was something
// submitted" - the actual pass/fail is bcrypt.compare against whatever
// hash is on file, whatever that policy was when the account was created.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export type LoginInput = z.infer<typeof loginSchema>;
