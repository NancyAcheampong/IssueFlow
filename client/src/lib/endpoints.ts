import { apiRequest } from "./api";
import type { Board, Issue, IssueStatus, Project, SafeUser } from "./types";

export function signup(email: string, displayName: string, password: string) {
  return apiRequest<{ user: SafeUser }>("/auth/signup", {
    method: "POST",
    body: { email, displayName, password },
  });
}

export function login(email: string, password: string) {
  return apiRequest<{ user: SafeUser; token: string }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function getMe(token: string) {
  return apiRequest<{ user: SafeUser }>("/me", { token });
}

export function listProjects(token: string) {
  return apiRequest<{ projects: Project[] }>("/projects", { token });
}

export function createProject(
  token: string,
  name: string,
  description?: string,
) {
  return apiRequest<{ project: Project }>("/projects", {
    method: "POST",
    token,
    body: { name, description },
  });
}

export function getBoard(token: string, projectId: string) {
  return apiRequest<{ board: Board }>(`/projects/${projectId}/board`, {
    token,
  });
}

export interface MoveIssueInput {
  status?: IssueStatus;
  prevIssueId?: string | null;
  nextIssueId?: string | null;
  version: number;
}

export function moveIssue(
  token: string,
  issueId: string,
  input: MoveIssueInput,
) {
  return apiRequest<{ issue: Issue }>(`/issues/${issueId}/move`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function createIssue(token: string, projectId: string, title: string) {
  return apiRequest<{ issue: Issue }>(`/projects/${projectId}/issues`, {
    method: "POST",
    token,
    body: { title },
  });
}
