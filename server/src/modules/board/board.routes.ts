import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { getProjectMembership } from "../projects/projects.service.js";
import { issueFilterQuerySchema } from "../issues/issues.schemas.js";
import { getBoardForProject } from "./board.service.js";

// Mounted at /api/v1/projects.
export const boardRouter = Router();

// GET /api/v1/projects/:projectId/board - member-level, same D-06
// pattern as every other project-scoped read. SRC-01..03/D-26: accepts
// the same ?search=/?status=/?assigneeId=/?labelId= as the paginated
// issue list - a board showing only the cards that match a filter,
// still grouped by column.
boardRouter.get(
  "/:projectId/board",
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

    const query = issueFilterQuerySchema.parse(req.query);
    const board = await getBoardForProject(projectId, query);
    res.status(200).json({ board });
  }),
);

