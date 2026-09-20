import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { getIssueById } from "../issues/issues.service.js";
import { createCommentSchema } from "./comments.schemas.js";
import { createComment, listCommentsForIssue } from "./comments.service.js";

// Mounted at /api/v1/issues - nested under an issue rather than a
// project, same reasoning as issueRouter (issues.routes.ts):
// authorization runs through getIssueById, which already applies the
// D-06 policy (404 for non-members) by looking the issue up first to
// find its project.
export const commentsRouter = Router();

// POST /api/v1/issues/:issueId/comments - COM-01/COM-02/COM-03.
// Member-level, same as creating an issue itself.
commentsRouter.post(
  "/:issueId/comments",
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

    const input = createCommentSchema.parse(req.body);
    const comment = await createComment(issueId, issue.projectId, req.userId, input);
    res.status(201).json({ comment });
  }),
);

// GET /api/v1/issues/:issueId/comments - flat list, oldest first.
commentsRouter.get(
  "/:issueId/comments",
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

    const comments = await listCommentsForIssue(issueId);
    res.status(200).json({ comments });
  }),
);
