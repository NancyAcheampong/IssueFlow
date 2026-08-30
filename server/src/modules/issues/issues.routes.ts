import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { getProjectMembership } from "../projects/projects.service.js";
import { createIssueSchema } from "./issues.schemas.js";
import { createIssue } from "./issues.service.js";

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
