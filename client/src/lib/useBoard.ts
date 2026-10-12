import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "./api";
import { getBoard, moveIssue } from "./endpoints";
import { computeMove, replaceIssueInBoard } from "./boardLogic";
import { connectRealtimeSocket } from "./realtime";
import type { Board, IssueFilters, IssueStatus } from "./types";

interface UseBoardResult {
  board: Board | null;
  loading: boolean;
  error: string | null;
  moveCard: (
    issueId: string,
    destinationStatus: IssueStatus,
    destinationIndex: number,
  ) => Promise<void>;
  reload: () => void;
}

// Sep 17/18 (D-20/D-23): fetches the board and exposes one `moveCard`
// function that both drag-and-drop (BoardPage's onDragEnd) and the
// keyboard-accessible "move to column" control funnel through - same
// optimistic-update-then-rollback behavior regardless of which
// triggered it.
//
// `filters` (Phase 6/SRC-01..03): the caller (BoardPage) owns the
// filter *state* (what's typed in the search box, which checkboxes
// are on) - this hook only needs a stable key to know when that state
// has actually changed, since a fresh `filters` object every render
// would otherwise refire the fetch effect every render regardless of
// whether anything in it changed. JSON.stringify is enough here: this
// object is always plain strings/arrays of strings, nothing where
// stringify's quirks (key order, Dates, etc.) could bite.
export function useBoard(token: string, projectId: string, filters?: IssueFilters): UseBoardResult {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const filtersKey = useMemo(() => JSON.stringify(filters ?? {}), [filters]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getBoard(token, projectId, filters)
      .then(({ board: fetched }) => {
        if (!cancelled) {
          setBoard(fetched);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to load the board.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // filtersKey (not filters) is the real dependency - see the
    // comment above the function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, projectId, reloadToken, filtersKey]);

  // Phase 5/D-25: the live-update channel is deliberately dumb - it
  // only ever says "something in this project changed," never carries
  // a payload - so the reaction to it is just `reload()`, the exact
  // same function the "Add issue" button's `reload()` call already
  // uses. One socket per mount, joining this project's room; `reload`
  // is excluded from the dependency array on purpose (it's a stable
  // `useCallback` that never actually changes) so this effect only
  // re-runs when the connection itself needs to change (token or
  // project). `connect` (Socket.IO's own event, fired on the initial
  // connection *and* every automatic reconnect) re-joins the room and
  // reloads the board - this is what satisfies "handle reconnects,
  // re-fetch state" (Sep 28): a reconnect is just another reason to
  // refetch, not a separate code path.
  useEffect(() => {
    if (!token || !projectId) {
      return;
    }

    const socket = connectRealtimeSocket(token);

    socket.on("connect", () => {
      socket.emit("join", projectId);
      reload();
    });
    socket.on("project:changed", () => {
      reload();
    });

    return () => {
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, projectId]);

  const moveCard = useCallback(
    async (
      issueId: string,
      destinationStatus: IssueStatus,
      destinationIndex: number,
    ) => {
      if (!board) {
        return;
      }

      // Snapshot before mutating anything - this, not any attempt to
      // "undo" the optimistic change piece by piece, is what a failed
      // move rolls back to (D-23).
      const boardBeforeMove = board;
      const { nextBoard, movedIssue, prevIssueId, nextIssueId } = computeMove(
        board,
        issueId,
        destinationStatus,
        destinationIndex,
      );
      // computeMove only overrides `status` on the returned issue -
      // `boardPlacement` (and its `version`) is still exactly what the
      // server last told us, which is what optimistic concurrency
      // needs to send back (D-20).
      const versionBeforeMove = movedIssue.boardPlacement?.version ?? 0;

      setBoard(nextBoard);
      setError(null);

      try {
        const { issue: updated } = await moveIssue(token, issueId, {
          status: destinationStatus,
          prevIssueId,
          nextIssueId,
          version: versionBeforeMove,
        });
        setBoard((current) =>
          current ? replaceIssueInBoard(current, updated) : current,
        );
      } catch (err) {
        // D-23: revert to the exact pre-move snapshot, not a
        // best-effort patch-up - the optimistic state might already
        // be wrong in ways beyond just this one card (another move
        // from elsewhere could have landed in between).
        setBoard(boardBeforeMove);
        setError(
          err instanceof ApiError
            ? err.message
            : "Couldn't move that card. Please try again.",
        );
      }
    },
    [board, token],
  );

  return { board, loading, error, moveCard, reload };
}
