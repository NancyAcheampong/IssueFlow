import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { createProjectSchema } from "./projects.schemas.js";
import { createProject } from "./projects.service.js";

export const projectsRouter = Router();

// POST /api/v1/projects - PRJ-01. Authenticated user creates a project
// and becomes both its owner and first member.
projectsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }

    const input = createProjectSchema.parse(req.body);
    const project = await createProject(req.userId, input);
    res.status(201).json({ project });
  }),
);
