import { describe, expect, it } from "vitest";
import {
  computeMove,
  replaceIssueInBoard,
  resolveDropTarget,
} from "./boardLogic";
import type { Board, Issue } from "./types";

function makeIssue(
  id: string,
  status: Issue["status"],
  overrides: Partial<Issue> = {},
): Issue {
  return {
    id,
    projectId: "p1",
    number: 1,
    title: `Issue ${id}`,
    description: null,
    status,
    authorId: "u1",
    assigneeId: null,
    boardPlacement: {
      issueId: id,
      projectId: "p1",
      rank: id,
      version: 0,
      updatedAt: "",
    },
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function makeBoard(partial: Partial<Board>): Board {
  return { BACKLOG: [], TODO: [], IN_PROGRESS: [], DONE: [], ...partial };
}

describe("computeMove", () => {
  it("moves a card into a different, empty column", () => {
    const a = makeIssue("a", "BACKLOG");
    const board = makeBoard({ BACKLOG: [a] });

    const result = computeMove(board, "a", "TODO", 0);

    expect(result.nextBoard.BACKLOG).toHaveLength(0);
    expect(result.nextBoard.TODO.map((i) => i.id)).toEqual(["a"]);
    expect(result.movedIssue.status).toBe("TODO");
    expect(result.prevIssueId).toBeNull();
    expect(result.nextIssueId).toBeNull();
  });

  it("computes the correct neighbors when inserting between two existing cards", () => {
    const a = makeIssue("a", "TODO");
    const b = makeIssue("b", "TODO");
    const c = makeIssue("c", "BACKLOG");
    const board = makeBoard({ TODO: [a, b], BACKLOG: [c] });

    const result = computeMove(board, "c", "TODO", 1);

    expect(result.nextBoard.TODO.map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(result.prevIssueId).toBe("a");
    expect(result.nextIssueId).toBe("b");
  });

  it("reorders a card within its own column without duplicating or losing it", () => {
    const a = makeIssue("a", "BACKLOG");
    const b = makeIssue("b", "BACKLOG");
    const c = makeIssue("c", "BACKLOG");
    const board = makeBoard({ BACKLOG: [a, b, c] });

    // Move "a" to the end of the same column.
    const result = computeMove(board, "a", "BACKLOG", 2);

    expect(result.nextBoard.BACKLOG.map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(result.prevIssueId).toBe("c");
    expect(result.nextIssueId).toBeNull();
  });

  it("clamps an out-of-range destination index to the end of the column", () => {
    const a = makeIssue("a", "BACKLOG");
    const board = makeBoard({ BACKLOG: [], TODO: [a] });

    const result = computeMove(board, "a", "BACKLOG", 99);

    expect(result.nextBoard.BACKLOG.map((i) => i.id)).toEqual(["a"]);
  });

  it("preserves boardPlacement (and its version) on the moved issue, only changing status", () => {
    const a = makeIssue("a", "BACKLOG", {
      boardPlacement: {
        issueId: "a",
        projectId: "p1",
        rank: "x",
        version: 3,
        updatedAt: "",
      },
    });
    const board = makeBoard({ BACKLOG: [a] });

    const result = computeMove(board, "a", "DONE", 0);

    expect(result.movedIssue.boardPlacement?.version).toBe(3);
  });

  it("throws if the issue isn't on the board at all", () => {
    const board = makeBoard({});
    expect(() => computeMove(board, "missing", "BACKLOG", 0)).toThrow();
  });
});

describe("resolveDropTarget", () => {
  it("resolves dropping directly on an empty column to the end of that column", () => {
    const a = makeIssue("a", "BACKLOG");
    const board = makeBoard({ BACKLOG: [a], TODO: [] });

    expect(resolveDropTarget(board, "a", "TODO")).toEqual({
      status: "TODO",
      index: 0,
    });
  });

  it("resolves dropping on another card to that card's index", () => {
    const a = makeIssue("a", "TODO");
    const b = makeIssue("b", "TODO");
    const board = makeBoard({ TODO: [a, b] });

    expect(resolveDropTarget(board, "b", "a")).toEqual({
      status: "TODO",
      index: 0,
    });
  });

  it("excludes the dragged card itself from the index calculation (same-column reorder)", () => {
    const a = makeIssue("a", "BACKLOG");
    const b = makeIssue("b", "BACKLOG");
    const c = makeIssue("c", "BACKLOG");
    const board = makeBoard({ BACKLOG: [a, b, c] });

    // Dragging "a" (currently index 0) onto "c" should land it at
    // index 1 in the post-removal list [b, c], not index 2 - the
    // classic off-by-one if the active card weren't excluded first.
    expect(resolveDropTarget(board, "a", "c")).toEqual({
      status: "BACKLOG",
      index: 1,
    });
  });

  it("returns null for an unresolvable drop target", () => {
    const board = makeBoard({});
    expect(resolveDropTarget(board, "a", "not-a-real-id")).toBeNull();
  });
});

describe("replaceIssueInBoard", () => {
  it("swaps in the updated issue wherever it currently sits", () => {
    const a = makeIssue("a", "BACKLOG");
    const board = makeBoard({ BACKLOG: [a] });

    const updated = {
      ...a,
      status: "DONE" as const,
      boardPlacement: { ...a.boardPlacement!, version: 1 },
    };
    const nextBoard = replaceIssueInBoard(board, updated);

    expect(nextBoard.BACKLOG[0]?.boardPlacement?.version).toBe(1);
  });
});
