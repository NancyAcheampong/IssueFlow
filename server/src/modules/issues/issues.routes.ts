import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { getProjectMembership } from "../projects/projects.service.js";
import { createIssueSchema } from "./issues.schemas.js";
import { createIssue, getIssueById, listIssuesForProject } from "./issues.service.js";

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

    const issues = await listIssuesForProject(projectId);
    res.status(200).json({ issues });
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
