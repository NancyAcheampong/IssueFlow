import { ISSUE_STATUSES } from "./types";
import type { Board, Issue, IssueStatus } from "./types";

// Pure board-manipulation logic, deliberately kept free of React and
// @dnd-kit so it's testable without rendering anything or simulating
// pointer/keyboard events (see tests/boardLogic.test.ts). The
// drag-and-drop handler and the keyboard "move to column" control
// (Sep 17/19) both funnel through this same function - one place that
// decides what a move actually does to the board, however it was
// triggered.

export interface ComputedMove {
  nextBoard: Board;
  movedIssue: Issue;
  prevIssueId: string | null;
  nextIssueId: string | null;
}

// Removes `issueId` from wherever it currently sits on the board and
// re-inserts it into `destinationStatus` at `destinationIndex`,
// returning both the resulting board and the neighbor ids
// (prevIssueId/nextIssueId) that the PATCH .../move request needs -
// see DECISIONS.md D-20 for why the API takes neighbors rather than a
// raw index or rank.
export function computeMove(
  board: Board,
  issueId: string,
  destinationStatus: IssueStatus,
  destinationIndex: number,
): ComputedMove {
  let movedIssue: Issue | undefined;
  const withoutMoved: Board = { ...board };

  for (const status of ISSUE_STATUSES) {
    const index = board[status].findIndex((issue) => issue.id === issueId);
    if (index !== -1) {
      movedIssue = board[status][index];
      withoutMoved[status] = board[status].filter(
        (issue) => issue.id !== issueId,
      );
      break;
    }
  }

  if (!movedIssue) {
    throw new Error(`computeMove: issue ${issueId} is not on the board.`);
  }

  const destinationList = withoutMoved[destinationStatus];
  const clampedIndex = Math.max(
    0,
    Math.min(destinationIndex, destinationList.length),
  );
  const prevIssueId =
    clampedIndex > 0 ? (destinationList[clampedIndex - 1]?.id ?? null) : null;
  const nextIssueId =
    clampedIndex < destinationList.length
      ? (destinationList[clampedIndex]?.id ?? null)
      : null;

  const updatedIssue: Issue = { ...movedIssue, status: destinationStatus };
  const newDestinationList = [
    ...destinationList.slice(0, clampedIndex),
    updatedIssue,
    ...destinationList.slice(clampedIndex),
  ];

  const nextBoard: Board = {
    ...withoutMoved,
    [destinationStatus]: newDestinationList,
  };

  return { nextBoard, movedIssue: updatedIssue, prevIssueId, nextIssueId };
}

// After the server confirms a move (or any other issue update), swap
// in the authoritative row it returned - most importantly its new
// `boardPlacement.version`, which the *next* move needs to send back
// for optimistic concurrency to keep working (D-20). Without this, a
// second move in a row would use a stale version and always 409.
export function replaceIssueInBoard(board: Board, updated: Issue): Board {
  const nextBoard: Board = { ...board };
  for (const status of ISSUE_STATUSES) {
    nextBoard[status] = board[status].map((issue) =>
      issue.id === updated.id ? updated : issue,
    );
  }
  return nextBoard;
}

// Resolves a dnd-kit drop target (`over.id`, which is either a card id
// or a column's own id, since each column is itself droppable - see
// Column.tsx) into a destination status + index that computeMove can
// use directly. The index is computed against the destination
// column's list *with the dragged card already excluded* - without
// that, reordering a card within its own column would be off by one
// whenever it starts out earlier in the list than where it's dropped
// (a classic sortable-list bug, not a hypothetical one).
export function resolveDropTarget(
  board: Board,
  activeId: string,
  overId: string,
): { status: IssueStatus; index: number } | null {
  if ((ISSUE_STATUSES as readonly string[]).includes(overId)) {
    const status = overId as IssueStatus;
    const listWithoutActive = board[status].filter(
      (issue) => issue.id !== activeId,
    );
    return { status, index: listWithoutActive.length };
  }

  for (const status of ISSUE_STATUSES) {
    const listWithoutActive = board[status].filter(
      (issue) => issue.id !== activeId,
    );
    const index = listWithoutActive.findIndex((issue) => issue.id === overId);
    if (index !== -1) {
      return { status, index };
    }
  }

  return null;
}
