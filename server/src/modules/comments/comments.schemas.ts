import { z } from "zod";

// COM-01/COM-02/COM-03: body is required Markdown text; parentId is
// optional (top-level comment vs. a threaded reply - COM-03,
// Sep 8/D-16). Whether a given parentId is actually a comment on the
// *same* issue is a DB lookup, so it's validated in the service layer,
// not here (same split as ASN-02's assignee-membership check).
export const createCommentSchema = z.object({
  bodyMarkdown: z
    .string()
    .trim()
    .min(1, "Comment body is required.")
    .max(10000, "Comment is too long."),
  parentId: z.string().trim().min(1, "Invalid parent comment id.").optional(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
