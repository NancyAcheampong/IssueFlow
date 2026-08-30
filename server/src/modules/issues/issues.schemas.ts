import { z } from "zod";

// Matches the Prisma-generated IssueStatus enum values exactly (same
// uppercase-in-API convention already established for ProjectRole -
// see how membership.role comes back as "OWNER"/"MEMBER").
export const issueStatusValues = ["BACKLOG", "TODO", "IN_PROGRESS", "DONE"] as const;

// ISS-01/ISS-02: title required and trimmed; description, status, and
// assignee are all optional at creation. Labels aren't in this schema -
// they don't exist until Phase 3.
export const createIssueSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  description: z.string().trim().max(20000, "Description is too long.").optional(),
  status: z.enum(issueStatusValues).optional(),
  assigneeId: z.string().trim().min(1, "Invalid assignee id.").optional(),
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
