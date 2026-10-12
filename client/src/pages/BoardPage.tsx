import { useEffect, useState } from "react";
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
import { usePageTitle } from "../lib/usePageTitle";
import { resolveDropTarget } from "../lib/boardLogic";
import { ISSUE_STATUSES, STATUS_LABELS } from "../lib/types";
import type { IssueFilters, IssueStatus, Label, SafeUser } from "../lib/types";
import { createIssue, listLabels, listMembers } from "../lib/endpoints";
import { Column } from "../components/Column";

// SRC-01: 300ms - long enough to collapse a burst of keystrokes into
// one request (nobody actually wants a fetch fired mid-word), short
// enough to still feel like "as you type," not a separate submit step.
const SEARCH_DEBOUNCE_MS = 300;

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function BoardPage() {
  usePageTitle("Board");
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<IssueStatus[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<SafeUser[]>([]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  // Populates the filter checkboxes - fetched once per project, not
  // re-fetched on every filter change (labels/membership don't change
  // nearly as often as the filter selection does).
  useEffect(() => {
    if (!token || !projectId) {
      return;
    }
    listLabels(token, projectId)
      .then(({ labels: fetched }) => setLabels(fetched))
      .catch(() => setLabels([]));
    listMembers(token, projectId)
      .then(({ members: fetched }) => setMembers(fetched))
      .catch(() => setMembers([]));
  }, [token, projectId]);

  const filters: IssueFilters = {
    search: debouncedSearch.trim() || undefined,
    status: statusFilter.length > 0 ? statusFilter : undefined,
    assigneeId: assigneeFilter.length > 0 ? assigneeFilter : undefined,
    labelId: labelFilter.length > 0 ? labelFilter : undefined,
  };
  const hasActiveFilters =
    Boolean(filters.search) || statusFilter.length > 0 || assigneeFilter.length > 0 || labelFilter.length > 0;

  const { board, loading, error, moveCard, reload } = useBoard(
    token ?? "",
    projectId ?? "",
    filters,
  );

  // Sep 17/19 (D-22): pointer sensor for mouse/touch drag, keyboard
  // sensor for arrow-key reordering within a column - dnd-kit's own
  // built-in accessible path. The explicit "Move to" <select> on each
  // card (Card.tsx) is the primary accessible way to move *between*
  // columns, since dnd-kit's keyboard sensor across *different*
  // containers is a materially harder gesture to discover/operate
  // than a select element.
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

  function clearFilters() {
    setSearchInput("");
    setDebouncedSearch("");
    setStatusFilter([]);
    setAssigneeFilter([]);
    setLabelFilter([]);
  }

  const totalCards = board
    ? ISSUE_STATUSES.reduce((sum, status) => sum + board[status].length, 0)
    : 0;

  return (
    <div className="board-page">
      <header className="board-header">
        <div className="board-header-title">
          <Link to="/projects">&larr; Projects</Link>
          {/* Oct 8 accessibility pass: every page needs exactly one
              <h1> - this one was missing it entirely. The project's
              own name isn't fetched anywhere in the client yet (no
              GET /projects/:id endpoint exists to fetch a single
              project by id), so this is deliberately generic for now
              rather than a half-correct guess - see client/README.md
              Known gaps for the follow-up. */}
          <h1>Board</h1>
        </div>
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

      <section className="filters" aria-label="Search and filter issues">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search title or description"
          aria-label="Search issues"
          className="filters-search"
        />

        <fieldset className="filter-group">
          <legend>Status</legend>
          {ISSUE_STATUSES.map((status) => (
            <label key={status} className="filter-checkbox">
              <input
                type="checkbox"
                checked={statusFilter.includes(status)}
                onChange={() => setStatusFilter((current) => toggleValue(current, status))}
              />
              {STATUS_LABELS[status]}
            </label>
          ))}
        </fieldset>

        {members.length > 0 && (
          <fieldset className="filter-group">
            <legend>Assignee</legend>
            {members.map((member) => (
              <label key={member.id} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={assigneeFilter.includes(member.id)}
                  onChange={() => setAssigneeFilter((current) => toggleValue(current, member.id))}
                />
                {member.displayName}
              </label>
            ))}
          </fieldset>
        )}

        {labels.length > 0 && (
          <fieldset className="filter-group">
            <legend>Label</legend>
            {labels.map((label) => (
              <label key={label.id} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={labelFilter.includes(label.id)}
                  onChange={() => setLabelFilter((current) => toggleValue(current, label.id))}
                />
                {label.name}
              </label>
            ))}
          </fieldset>
        )}

        {hasActiveFilters && (
          <button type="button" className="filters-clear" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </section>

      {error && (
        <p role="alert" className="board-error">
          {error}
        </p>
      )}

      {loading && <p>Loading board…</p>}

      {!loading && board && totalCards === 0 && (
        <p className="board-empty">
          {hasActiveFilters ? "No issues match these filters." : "No issues yet — add one above."}
        </p>
      )}

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
