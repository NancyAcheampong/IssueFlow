import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { addMemberSchema, createProjectSchema } from "./projects.schemas.js";
import {
  addMember,
  createProject,
  getProjectMembership,
  listProjectsForUser,
  requireOwnerRole,
} from "./projects.service.js";

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

// GET /api/v1/projects - PRJ-02. Only projects the requester owns or
// belongs to.
projectsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }

    const projects = await listProjectsForUser(req.userId);
    res.status(200).json({ projects });
  }),
);

// POST /api/v1/projects/:projectId/members - PRJ-03. Owner-only. A
// requester who isn't a member at all gets 404 (getProjectMembership);
// a member who isn't the owner gets 403 (requireOwnerRole) - see
// DECISIONS.md D-06 for why those are two different responses.
projectsRouter.post(
  "/:projectId/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { projectId } = req.params;
    if (!projectId) {
      throw AppError.badRequest("A project ID is required.");
    }

    const { project, membership } = await getProjectMembership(projectId, req.userId);
    requireOwnerRole(membership);

    const input = addMemberSchema.parse(req.body);
    const member = await addMember(project.id, input.email);
    res.status(201).json({ member });
  }),
);
