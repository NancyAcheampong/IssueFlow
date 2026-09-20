import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { getProjectMembership } from "../projects/projects.service.js";
import {
  createIssueSchema,
  listIssuesQuerySchema,
  moveIssueSchema,
  updateIssueSchema,
} from "./issues.schemas.js";
import {
  closeIssue,
  createIssue,
  getIssueById,
  listIssuesForProject,
  moveIssue,
  reopenIssue,
  updateIssue,
} from "./issues.service.js";

// Mounted at /api/v1/projects.
export const issuesRouter = Router();

// POST /api/v1/projects/:projectId/issues - ISS-01. Any project member
// can create an issue - just getProjectMembership's "are you in this
// project at all" check (404 if not, per D-06), no owner-only gate.
issuesRouter.post(
  "/:projectId/issues",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { projectId } = req.params;
    if (!projectId) {
      throw AppError.badRequest("A project ID is required.");
    }

    await getProjectMembership(projectId, req.userId);

    const input = createIssueSchema.parse(req.body);
    const issue = await createIssue(projectId, req.userId, input);
    res.status(201).json({ issue });
  }),
);

// GET /api/v1/projects/:projectId/issues - "Search/list" in the spec's
// reference table; this is the plain list for now. Keyword search and
// filters are Phase 6, pagination is ISS-07 (P1, later this phase).
issuesRouter.get(
  "/:projectId/issues",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { projectId } = req.params;
    if (!projectId) {
      throw AppError.badRequest("A project ID is required.");
    }

    await getProjectMembership(projectId, req.userId);

    const query = listIssuesQuerySchema.parse(req.query);
    const { issues, pagination } = await listIssuesForProject(projectId, query);
    res.status(200).json({ issues, pagination });
  }),
);

// Mounted at /api/v1/issues - deliberately separate from issuesRouter
// above: this path isn't nested under a project, so it needs its own
// authorization path (see getIssueById in the service).
export const issueRouter = Router();

// GET /api/v1/issues/:issueId - ISS-03.
issueRouter.get(
  "/:issueId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { issueId } = req.params;
    if (!issueId) {
      throw AppError.badRequest("An issue ID is required.");
    }

    const issue = await getIssueById(issueId, req.userId);
    res.status(200).json({ issue });
  }),
);

// PATCH /api/v1/issues/:issueId - ISS-04. Any project member can edit
// title/description/assignee (member-level, not owner-only - same
// getIssueById D-06 check as GET, no requireOwnerRole gate). Status
// transitions and labels are out of scope here - see the comment on
// updateIssueSchema.
issueRouter.patch(
  "/:issueId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { issueId } = req.params;
    if (!issueId) {
      throw AppError.badRequest("An issue ID is required.");
    }

    // getIssueById both enforces D-06 and hands back the issue's
    // projectId, which updateIssue needs for assignee validation -
    // no separate lookup.
    const issue = await getIssueById(issueId, req.userId);

    const input = updateIssueSchema.parse(req.body);
    const updated = await updateIssue(issueId, issue.projectId, input);
    res.status(200).json({ issue: updated });
  }),
);

// POST /api/v1/issues/:issueId/close - ISS-05. Member-level, idempotent
// (closing an already-closed issue is a 200 no-op, not an error).
issueRouter.post(
  "/:issueId/close",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { issueId } = req.params;
    if (!issueId) {
      throw AppError.badRequest("An issue ID is required.");
    }

    await getIssueById(issueId, req.userId);
    const issue = await closeIssue(issueId);
    res.status(200).json({ issue });
  }),
);

// POST /api/v1/issues/:issueId/reopen - ISS-05. Same shape as close,
// same idempotency guarantee.
issueRouter.post(
  "/:issueId/reopen",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { issueId } = req.params;
    if (!issueId) {
      throw AppError.badRequest("An issue ID is required.");
    }

    await getIssueById(issueId, req.userId);
    const issue = await reopenIssue(issueId);
    res.status(200).json({ issue });
  }),
);

// PATCH /api/v1/issues/:issueId/move - Phase 4/D-20. Member-level, same
// as every other issue write. Status + rank change atomically; a stale
// `version` is rejected with 409 rather than silently overwriting a
// concurrent move.
issueRouter.patch(
  "/:issueId/move",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { issueId } = req.params;
    if (!issueId) {
      throw AppError.badRequest("An issue ID is required.");
    }

    const issue = await getIssueById(issueId, req.userId);

    const input = moveIssueSchema.parse(req.body);
    const moved = await moveIssue(issueId, issue.projectId, input);
    res.status(200).json({ issue: moved });
  }),
);
