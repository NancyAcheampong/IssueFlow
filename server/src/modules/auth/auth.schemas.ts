import { z } from "zod";

// AUTH-01: unique normalized email, display name, password. Normalizing
// here (trim + lowercase) means every downstream consumer - the unique
// constraint, later logins, @mention lookups - works off the same
// canonical value instead of each caller remembering to normalize it.
export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  displayName: z.string().trim().min(1, "Display name is required.").max(100, "Display name is too long."),
  // No spec-mandated minimum; 8 characters is a reasonable baseline and
  // easy to change in one place if that policy needs to grow later.
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export type SignupInput = z.infer<typeof signupSchema>;

// AUTH-02. No minimum-length check here on purpose: this isn't validating
// a *new* password against today's policy, it's just "was something
// submitted" - the actual pass/fail is bcrypt.compare against whatever
// hash is on file, whatever that policy was when the account was created.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export type LoginInput = z.infer<typeof loginSchema>;
