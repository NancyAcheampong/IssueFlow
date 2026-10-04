import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "./api";
import { useBoard } from "./useBoard";
import type { Board, Issue } from "./types";

// Mocks the endpoints module (not fetch itself) - useBoard only talks
// to getBoard/moveIssue, so that's the real seam to fake for a
// hook-level test, same spirit as the server tests using real
// Postgres but faking nothing *inside* the layer under test.
vi.mock("./endpoints", () => ({
  getBoard: vi.fn(),
  moveIssue: vi.fn(),
}));

import { getBoard, moveIssue } from "./endpoints";

function makeIssue(id: string, status: Issue["status"]): Issue {
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
  };
}

function makeBoard(partial: Partial<Board>): Board {
  return { BACKLOG: [], TODO: [], IN_PROGRESS: [], DONE: [], ...partial };
}

describe("useBoard", () => {
  it("applies a move optimistically, then reconciles with the server's response", async () => {
    const a = makeIssue("a", "BACKLOG");
    const initialBoard = makeBoard({ BACKLOG: [a] });
    vi.mocked(getBoard).mockResolvedValue({ board: initialBoard });
    vi.mocked(moveIssue).mockResolvedValue({
      issue: {
        ...a,
        status: "TODO",
        boardPlacement: { ...a.boardPlacement!, version: 1 },
      },
    });

    const { result } = renderHook(() => useBoard("token", "p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.moveCard("a", "TODO", 0);
    });

    expect(result.current.board?.TODO.map((i) => i.id)).toEqual(["a"]);
    expect(result.current.board?.BACKLOG).toHaveLength(0);
    expect(result.current.board?.TODO[0]?.boardPlacement?.version).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("rolls back to the pre-move board and surfaces an error when the server rejects the move (D-23)", async () => {
    const a = makeIssue("a", "BACKLOG");
    const b = makeIssue("b", "TODO");
    const initialBoard = makeBoard({ BACKLOG: [a], TODO: [b] });
    vi.mocked(getBoard).mockResolvedValue({ board: initialBoard });
    vi.mocked(moveIssue).mockRejectedValue(
      new ApiError(409, "CONFLICT", "This card was moved by someone else."),
    );

    const { result } = renderHook(() => useBoard("token", "p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.moveCard("a", "TODO", 0);
    });

    // Rolled back exactly to the original board - "a" is back in
    // BACKLOG, TODO still only has "b", nothing duplicated or lost.
    expect(result.current.board?.BACKLOG.map((i) => i.id)).toEqual(["a"]);
    expect(result.current.board?.TODO.map((i) => i.id)).toEqual(["b"]);
    expect(result.current.error).toContain("moved by someone else");
  });

  it("sends the moved card's pre-move version for optimistic concurrency", async () => {
    const a = {
      ...makeIssue("a", "BACKLOG"),
      boardPlacement: {
        issueId: "a",
        projectId: "p1",
        rank: "a",
        version: 7,
        updatedAt: "",
      },
    };
    const initialBoard = makeBoard({ BACKLOG: [a] });
    vi.mocked(getBoard).mockResolvedValue({ board: initialBoard });
    vi.mocked(moveIssue).mockResolvedValue({ issue: { ...a, status: "DONE" } });

    const { result } = renderHook(() => useBoard("token", "p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.moveCard("a", "DONE", 0);
    });

    expect(moveIssue).toHaveBeenCalledWith(
      "token",
      "a",
      expect.objectContaining({ version: 7 }),
    );
  });
});
