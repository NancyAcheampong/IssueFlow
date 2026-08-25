import { z } from "zod";

// PRJ-01: required name, optional description.
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(200, "Project name is too long."),
  description: z.string().trim().max(2000, "Description is too long.").optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
