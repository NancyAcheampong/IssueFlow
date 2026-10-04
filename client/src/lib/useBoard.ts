import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";
import { getBoard, moveIssue } from "./endpoints";
import { computeMove, replaceIssueInBoard } from "./boardLogic";
import type { Board, IssueStatus } from "./types";

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
export function useBoard(token: string, projectId: string): UseBoardResult {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getBoard(token, projectId)
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
  }, [token, projectId, reloadToken]);

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
