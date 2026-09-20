import { z } from "zod";

// LBL-01: name required and trimmed; color is a hex code (GitHub's own
// convention, e.g. "#d73a4a") - validated here since it's a pure shape
// check, no DB lookup needed.
export const createLabelSchema = z.object({
  name: z.string().trim().min(1, "Label name is required.").max(50, "Label name is too long."),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a 6-digit hex code, e.g. #d73a4a."),
});

export type CreateLabelInput = z.infer<typeof createLabelSchema>;

// LBL-02: attach an existing label to an issue by id. Whether that id
// actually names a label in *this issue's* project is a DB lookup, so
// it's validated in the service layer (same split as assigneeId/
// parentId elsewhere in this codebase).
export const attachLabelSchema = z.object({
  labelId: z.string().trim().min(1, "A label id is required."),
});

export type AttachLabelInput = z.infer<typeof attachLabelSchema>;
