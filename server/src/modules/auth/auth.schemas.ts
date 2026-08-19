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
