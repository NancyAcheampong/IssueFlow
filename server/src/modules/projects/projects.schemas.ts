import { z } from "zod";

// PRJ-01: required name, optional description.
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(200, "Project name is too long."),
  description: z.string().trim().max(2000, "Description is too long.").optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// PRJ-03: identify the account to add by email, same normalization as
// signup/login so it matches whatever's actually stored.
export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;
