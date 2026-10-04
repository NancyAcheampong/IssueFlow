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

export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
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
