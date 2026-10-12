import { z } from "zod";

// Moved from auth.schemas.ts's old signupSchema (Oct 12) - same shape,
// same normalization (trim + lowercase email so the unique constraint,
// later logins, and @mention lookups all work off the same canonical
// value), just provisioned by an ADMIN now instead of submitted by the
// person themselves.
export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(100, "Display name is too long."),
  // Same "no spec-mandated minimum, 8 is a reasonable baseline" reasoning
  // as before - the admin sets this directly (there's no invite/email
  // flow), so it's effectively that person's initial password.
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
