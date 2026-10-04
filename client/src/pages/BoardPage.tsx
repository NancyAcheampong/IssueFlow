import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useAuth } from "../lib/AuthContext";
import { useBoard } from "../lib/useBoard";
import { resolveDropTarget } from "../lib/boardLogic";
import { ISSUE_STATUSES } from "../lib/types";
import { createIssue } from "../lib/endpoints";
import { Column } from "../components/Column";

export function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const { board, loading, error, moveCard, reload } = useBoard(
    token ?? "",
    projectId ?? "",
  );
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // Sep 17/19 (D-22): pointer sensor for mouse/touch drag, keyboard
  // sensor for arrow-key reordering within a column - dnd-kit's own
  // built-in accessible path. The explicit "Move to" <select> on each
  // card (Card.tsx) is the primary accessible way to move *between*
  // columns, since dnd-kit's keyboard sensor across *different*
  // containers is a materially harder gesture to operate than a
  // select element.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (!token || !projectId) {
    return <p>Missing project.</p>;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !board) {
      return;
    }

    const activeId = String(active.id);
    const target = resolveDropTarget(board, activeId, String(over.id));
    if (!target) {
      return;
    }

    void moveCard(activeId, target.status, target.index);
  }

  async function handleCreateIssue() {
    if (!newTitle.trim() || !projectId || !token) {
      return;
    }
    setCreating(true);
    try {
      await createIssue(token, projectId, newTitle.trim());
      setNewTitle("");
      reload();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="board-page">
      <header className="board-header">
        <Link to="/projects">&larr; Projects</Link>
        <form
          className="new-issue-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateIssue();
          }}
        >
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="New issue title"
            aria-label="New issue title"
          />
          <button type="submit" disabled={creating || !newTitle.trim()}>
            Add issue
          </button>
        </form>
      </header>

      {error && (
        <p role="alert" className="board-error">
          {error}
        </p>
      )}

      {loading && <p>Loading board…</p>}

      {board && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="board-columns">
            {ISSUE_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                issues={board[status]}
                onMoveToColumn={(issueId, destinationStatus) =>
                  void moveCard(
                    issueId,
                    destinationStatus,
                    board[destinationStatus].length,
                  )
                }
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
