import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AppError } from "../../lib/AppError.js";
import { getProjectMembership } from "../projects/projects.service.js";
import { getIssueById } from "../issues/issues.service.js";
import { attachLabelSchema, createLabelSchema } from "./labels.schemas.js";
import {
  attachLabelToIssue,
  createLabel,
  deleteLabel,
  detachLabelFromIssue,
  listLabelsForIssue,
  listLabelsForProject,
} from "./labels.service.js";

// Mounted at /api/v1/projects - LBL-01. Member-level throughout (no
// requireOwnerRole gate): labels are collaborative classification
// metadata, not a project-settings change.
export const projectLabelsRouter = Router();

projectLabelsRouter.post(
  "/:projectId/labels",
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

    const input = createLabelSchema.parse(req.body);
    const label = await createLabel(projectId, input);
    res.status(201).json({ label });
  }),
);

projectLabelsRouter.get(
  "/:projectId/labels",
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

    const labels = await listLabelsForProject(projectId);
    res.status(200).json({ labels });
  }),
);

projectLabelsRouter.delete(
  "/:projectId/labels/:labelId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { projectId, labelId } = req.params;
    if (!projectId || !labelId) {
      throw AppError.badRequest("A project ID and label ID are required.");
    }

    await getProjectMembership(projectId, req.userId);

    await deleteLabel(projectId, labelId);
    res.status(204).send();
  }),
);

// Mounted at /api/v1/issues - LBL-02. Attaching/detaching/listing a
// label on a specific issue.
export const issueLabelsRouter = Router();

issueLabelsRouter.post(
  "/:issueId/labels",
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

    const input = attachLabelSchema.parse(req.body);
    const labels = await attachLabelToIssue(issueId, issue.projectId, input.labelId);
    res.status(200).json({ labels });
  }),
);

issueLabelsRouter.get(
  "/:issueId/labels",
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

    const labels = await listLabelsForIssue(issueId);
    res.status(200).json({ labels });
  }),
);

issueLabelsRouter.delete(
  "/:issueId/labels/:labelId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.userId) {
      throw AppError.unauthorized();
    }
    const { issueId, labelId } = req.params;
    if (!issueId || !labelId) {
      throw AppError.badRequest("An issue ID and label ID are required.");
    }

    await getIssueById(issueId, req.userId);

    await detachLabelFromIssue(issueId, labelId);
    res.status(204).send();
  }),
);
