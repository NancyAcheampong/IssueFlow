import { beforeEach, describe, expect, it, vi } from "vitest";
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

// Phase 5: a real socket.io-client connection can't run inside jsdom
// (no server to connect to), so this fakes the one seam useBoard
// actually touches - connectRealtimeSocket - with a minimal
// EventEmitter-alike whose handlers tests can fire directly, the same
// "mock the module boundary, not the behavior under test" approach as
// the endpoints mock above.
vi.mock("./realtime", () => ({
  connectRealtimeSocket: vi.fn(),
}));

import { getBoard, moveIssue } from "./endpoints";
import { connectRealtimeSocket } from "./realtime";

type Handler = (...args: unknown[]) => void;

function makeFakeSocket() {
  const handlers: Record<string, Handler[]> = {};
  return {
    on: vi.fn((event: string, handler: Handler) => {
      (handlers[event] ??= []).push(handler);
    }),
    emit: vi.fn(),
    close: vi.fn(),
    trigger(event: string, ...args: unknown[]) {
      for (const handler of handlers[event] ?? []) {
        handler(...args);
      }
    },
  };
}


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
  beforeEach(() => {
    // vi.mock's mock functions persist call history across tests in
    // this file unless explicitly cleared - without this, a later
    // test's toHaveBeenCalledTimes(1) assertion would actually be
    // counting calls left over from every earlier test too.
    vi.clearAllMocks();

    // Every test gets a connected-but-otherwise-inert fake socket by
    // default, so the three pre-existing (Sep 17/18) tests below don't
    // need to know realtime exists at all - only the dedicated
    // realtime tests further down actually fire events on it.
    vi.mocked(connectRealtimeSocket).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeFakeSocket() as any,
    );
  });

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

  it("joins the project's room and reloads the board on connect (Phase 5/D-25)", async () => {
    const initialBoard = makeBoard({});
    vi.mocked(getBoard).mockResolvedValue({ board: initialBoard });
    const socket = makeFakeSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(connectRealtimeSocket).mockReturnValue(socket as any);

    renderHook(() => useBoard("token", "p1"));
    await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(1));

    act(() => {
      socket.trigger("connect");
    });

    expect(socket.emit).toHaveBeenCalledWith("join", "p1");
    // "connect" fires on the very first connection too, not just a
    // reconnect - this is deliberately the same refetch as a true
    // reconnect (Sep 28's "handle reconnects"), not a separate path.
    await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(2));
  });

  it("reloads the board when a project:changed event arrives, without being told what changed", async () => {
    const initialBoard = makeBoard({});
    vi.mocked(getBoard).mockResolvedValue({ board: initialBoard });
    const socket = makeFakeSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(connectRealtimeSocket).mockReturnValue(socket as any);

    renderHook(() => useBoard("token", "p1"));
    await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(1));

    act(() => {
      // D-25: the payload is intentionally ignored - the hook refetches
      // regardless of `type`, which is exactly the point of the
      // broadcast-then-refetch design (one source of truth for what
      // the board looks like).
      socket.trigger("project:changed", { type: "comment" });
    });

    await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(2));
  });

  it("closes the socket when the component unmounts", async () => {
    const initialBoard = makeBoard({});
    vi.mocked(getBoard).mockResolvedValue({ board: initialBoard });
    const socket = makeFakeSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(connectRealtimeSocket).mockReturnValue(socket as any);

    const { unmount } = renderHook(() => useBoard("token", "p1"));
    await waitFor(() => expect(getBoard).toHaveBeenCalledTimes(1));

    unmount();

    expect(socket.close).toHaveBeenCalled();
  });
});
