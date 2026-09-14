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

// ISS-04: any project member can edit title/description/assignee.
// Status transitions (close/reopen) and labels are deliberately out of
// scope here - status gets its own dedicated transition endpoint next
// (Sep 2 on the build schedule) rather than being a free-form field on
// a generic PATCH, and labels don't exist until Phase 3.
//
// All three fields are optional (a patch can touch just one), but at
// least one must be present - an empty patch isn't a meaningful
// request (same .refine pattern as updateProjectSchema). description
// follows the same "leave alone vs. clear" convention as
// updateProjectSchema: `undefined` means leave it alone, an explicit
// "" clears it (handled in the service layer). assigneeId goes one
// step further and is nullable: `undefined` leaves the assignee alone,
// `null` explicitly unassigns, and a string reassigns (validated
// against project membership in the service layer, same as at
// creation).
export const updateIssueSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long.").optional(),
    description: z.string().trim().max(20000, "Description is too long.").optional(),
    assigneeId: z.string().trim().min(1, "Invalid assignee id.").nullable().optional(),
  })
  .refine((data) => data.title !== undefined || data.description !== undefined || data.assigneeId !== undefined, {
    message: "Provide at least one field to update.",
  });

export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
