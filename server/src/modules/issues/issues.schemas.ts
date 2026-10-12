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
  .refine(
    (data) =>
      data.title !== undefined || data.description !== undefined || data.assigneeId !== undefined,
    {
      message: "Provide at least one field to update.",
    },
  );

export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

// ISS-07/SRC-01..03: pagination, keyword search, and filters on the
// issue list - all composable with each other in one query, not
// separate endpoints. Query params arrive as strings (Express doesn't
// coerce), so each piece here is responsible for its own parsing.
//
// SRC-02/SRC-03 ("combine filters: AND across, OR within"): `status`,
// `assigneeId`, and `labelId` each accept a comma-separated list - an
// issue matches if it matches *any* value within one param (OR), and
// the service layer ANDs the different params together. `commaList`
// is the shared piece of that: split on commas, trim, drop empties,
// require at least one survivor if the param was given at all.
function commaList<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .string()
    .transform((raw) => raw.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(valueSchema).min(1, "At least one value is required."));
}

// Shared across the paginated issue list (below) and the board
// endpoint (board.schemas.ts) - the same search/filter semantics
// apply to both surfaces (D-26), only pagination differs.
const issueFilterFields = {
  // SRC-01: case-insensitive substring match against title OR
  // description (see buildIssueWhere) - not a full-text/ranked search
  // engine, which the spec doesn't ask for at this scale.
  search: z.string().trim().min(1, "Search term cannot be empty.").max(200).optional(),
  status: commaList(z.enum(issueStatusValues)).optional(),
  // assigneeId/labelId aren't validated against real members/labels
  // here - an id that doesn't match anything simply filters down to
  // zero results, the same as searching for a word nobody used. No
  // information is leaked either way (this list is already scoped to
  // one project by the route/getProjectMembership before this schema
  // ever runs).
  assigneeId: commaList(z.string().trim().min(1)).optional(),
  labelId: commaList(z.string().trim().min(1)).optional(),
};

export const listIssuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  ...issueFilterFields,
});

export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>;

// Same filters, no pagination - the board shows every matching card,
// grouped by column, not a page of them.
export const issueFilterQuerySchema = z.object(issueFilterFields);
export type IssueFilterQuery = z.infer<typeof issueFilterQuerySchema>;

// Phase 4/D-19: moves a card - optionally into a different status
// column, and/or to a new position within its (destination) column.
// Position is expressed the way a drag-and-drop UI naturally has it:
// "this card now sits between prevIssueId and nextIssueId" - not a
// raw rank string, which is an implementation detail the client
// shouldn't need to know how to generate. Either neighbor may be
// omitted/null for "top of column" / "bottom of column".
//
// `version` is required, not optional: this is the whole point of
// optimistic concurrency (D-20) - the client states which version of
// the card's placement it's updating from, and the move is rejected
// (409) if that's stale, rather than silently overwriting a
// concurrent move.
export const moveIssueSchema = z.object({
  status: z.enum(issueStatusValues).optional(),
  prevIssueId: z.string().trim().min(1, "Invalid prevIssueId.").nullable().optional(),
  nextIssueId: z.string().trim().min(1, "Invalid nextIssueId.").nullable().optional(),
  version: z.number().int().nonnegative(),
});

export type MoveIssueInput = z.infer<typeof moveIssueSchema>;
