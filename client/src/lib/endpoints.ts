import { apiRequest } from "./api";
import type {
  Board,
  Issue,
  IssueFilters,
  IssueStatus,
  Label,
  Project,
  SafeUser,
} from "./types";

// POST /auth/signup removed (Oct 12) - IssueFlow has no public signup.
// Account creation is now createUser() below, admin-only.

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

// SRC-01..03/D-26: one function that knows how to turn filter state
// into the query string both GET .../board and (were a list view ever
// added) GET .../issues expect - comma-joined for the multi-value
// fields, omitted entirely when empty rather than sent as "".
function filtersToQueryString(filters?: IssueFilters): string {
  if (!filters) {
    return "";
  }
  const params = new URLSearchParams();
  if (filters.search) {
    params.set("search", filters.search);
  }
  if (filters.status && filters.status.length > 0) {
    params.set("status", filters.status.join(","));
  }
  if (filters.assigneeId && filters.assigneeId.length > 0) {
    params.set("assigneeId", filters.assigneeId.join(","));
  }
  if (filters.labelId && filters.labelId.length > 0) {
    params.set("labelId", filters.labelId.join(","));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getBoard(
  token: string,
  projectId: string,
  filters?: IssueFilters,
) {
  return apiRequest<{ board: Board }>(
    `/projects/${projectId}/board${filtersToQueryString(filters)}`,
    { token },
  );
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

// Phase 6: populates the status/assignee/label filter controls.
export function listLabels(token: string, projectId: string) {
  return apiRequest<{ labels: Label[] }>(`/projects/${projectId}/labels`, {
    token,
  });
}

export function listMembers(token: string, projectId: string) {
  return apiRequest<{ members: SafeUser[] }>(`/projects/${projectId}/members`, {
    token,
  });
}

export function addMember(token: string, projectId: string, email: string) {
  return apiRequest<{ member: SafeUser }>(`/projects/${projectId}/members`, {
    method: "POST",
    token,
    body: { email },
  });
}

export function removeMember(token: string, projectId: string, userId: string) {
  return apiRequest<null>(`/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
    token,
  });
}

// Admin-only account provisioning (Oct 12) - replaces the old public
// signup. createUser sets the account's initial password directly;
// there's no invite/email flow.
export function createUser(
  token: string,
  email: string,
  displayName: string,
  password: string,
) {
  return apiRequest<{ user: SafeUser }>("/admin/users", {
    method: "POST",
    token,
    body: { email, displayName, password },
  });
}

export function listUsers(token: string) {
  return apiRequest<{ users: SafeUser[] }>("/admin/users", { token });
}
