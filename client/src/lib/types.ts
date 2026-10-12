// Mirrors the server's API shapes (server/src/modules/**) just closely
// enough for the frontend to consume - not a generated/shared type
// package. Keeping these in sync by hand is a real cost, but there's
// no schema-sharing mechanism between server/ and client/ yet, and
// setting one up is a bigger decision than this page of types
// deserves on its own.

export const ISSUE_STATUSES = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "DONE",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const STATUS_LABELS: Record<IssueStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

// Site-wide role (Oct 12) - distinct from a project's OWNER/MEMBER
// role. Exactly one ADMIN exists in practice; only an ADMIN can
// provision new accounts (there's no public signup).
export type UserRole = "ADMIN" | "MEMBER";

export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardPlacement {
  issueId: string;
  projectId: string;
  rank: string;
  version: number;
  updatedAt: string;
}

export interface Issue {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  authorId: string;
  assigneeId: string | null;
  boardPlacement: BoardPlacement | null;
  createdAt: string;
  updatedAt: string;
}

export type Board = Record<IssueStatus, Issue[]>;

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: string;
}

// SRC-01..03: the same shape GET .../board and GET .../issues both
// take as query params (D-26) - one filter state, two endpoints that
// accept it.
export interface IssueFilters {
  search?: string;
  status?: IssueStatus[];
  assigneeId?: string[];
  labelId?: string[];
}
