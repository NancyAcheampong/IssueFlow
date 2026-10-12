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
import {
  addMember,
  createIssue,
  listLabels,
  listMembers,
  listProjects,
  removeMember,
} from "../lib/endpoints";
import { ApiError } from "../lib/api";
import { Column } from "../components/Column";
import { AppHeader } from "../components/AppHeader";
import styles from "./BoardPage.module.css";

// SRC-01: 300ms - long enough to collapse a burst of keystrokes into
// one request (nobody actually wants a fetch fired mid-word), short
// enough to still feel like "as you type," not a separate submit step.
const SEARCH_DEBOUNCE_MS = 300;

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

// Letter-avatar for the members panel - a deterministic hue from the
// member's own id (stable across reloads/sessions, no avatar image
// storage needed) keeps each person visually distinct at a glance.
function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 55%, 45%)`;
}

function initial(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase() || "?";
}

export function BoardPage() {
  usePageTitle("Board");
  const { projectId } = useParams<{ projectId: string }>();
  const { token, user } = useAuth();
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const [isOwner, setIsOwner] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<IssueStatus[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<SafeUser[]>([]);

  useEffect(() => {
    const timeout = setTimeout(
      () => setDebouncedSearch(searchInput),
      SEARCH_DEBOUNCE_MS,
    );
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
    // No GET /projects/:id endpoint exists yet (see client/README.md
    // Known gaps) - reusing the already-fetched project list to find
    // this one's ownerId avoids adding new API surface just to show/
    // hide the invite/remove controls.
    listProjects(token)
      .then(({ projects }) => {
        const project = projects.find(
          (candidate) => candidate.id === projectId,
        );
        setOwnerId(project?.ownerId ?? null);
        setIsOwner(Boolean(project && user && project.ownerId === user.id));
      })
      .catch(() => {
        setOwnerId(null);
        setIsOwner(false);
      });
  }, [token, projectId, user]);

  const filters: IssueFilters = {
    search: debouncedSearch.trim() || undefined,
    status: statusFilter.length > 0 ? statusFilter : undefined,
    assigneeId: assigneeFilter.length > 0 ? assigneeFilter : undefined,
    labelId: labelFilter.length > 0 ? labelFilter : undefined,
  };
  const hasActiveFilters =
    Boolean(filters.search) ||
    statusFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    labelFilter.length > 0;

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

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !token || !inviteEmail.trim()) {
      return;
    }
    setInviting(true);
    setMemberError(null);
    try {
      const { member } = await addMember(token, projectId, inviteEmail.trim());
      setMembers((current) => [...current, member]);
      setInviteEmail("");
    } catch (err) {
      setMemberError(
        err instanceof ApiError ? err.message : "Failed to add member.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!projectId || !token) {
      return;
    }
    setMemberError(null);
    try {
      await removeMember(token, projectId, memberId);
      setMembers((current) =>
        current.filter((member) => member.id !== memberId),
      );
      // A removed member may have been unassigned from issues
      // (server-side, atomically - see projects.service.ts removeMember)
      // - refetch so any now-unassigned cards reflect that.
      reload();
    } catch (err) {
      setMemberError(
        err instanceof ApiError ? err.message : "Failed to remove member.",
      );
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
    <>
      <AppHeader />
      <div className={styles.boardPage}>
        <header className={styles.boardHeader}>
          <div className={styles.boardHeaderTitle}>
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
            className={styles.newIssueForm}
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

        <section className={styles.membersPanel} aria-label="Project members">
          <h2>Members</h2>
          <ul className={styles.membersList}>
            {members.map((member) => (
              <li key={member.id} className={styles.memberRow}>
                <span className={styles.memberIdentity}>
                  <span
                    className={styles.avatar}
                    style={{ background: avatarColor(member.id) }}
                    aria-hidden="true"
                  >
                    {initial(member.displayName)}
                  </span>
                  <span className={styles.memberName}>
                    {member.displayName}
                  </span>
                  {member.id === ownerId && (
                    <span className={styles.ownerBadge}>Owner</span>
                  )}
                  <span className={styles.memberEmail}>{member.email}</span>
                </span>
                {isOwner && member.id !== user?.id && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveMember(member.id)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          {memberError && <p role="alert">{memberError}</p>}

          {isOwner && (
            <form onSubmit={handleInvite} className={styles.inviteForm}>
              <label htmlFor="invite-email">Invite by email</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@example.com"
              />
              <button type="submit" disabled={inviting || !inviteEmail.trim()}>
                Invite
              </button>
            </form>
          )}
        </section>

        <section
          className={styles.filters}
          aria-label="Search and filter issues"
        >
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search title or description"
            aria-label="Search issues"
            className={styles.filtersSearch}
          />

          <fieldset className={styles.filterGroup}>
            <legend>Status</legend>
            {ISSUE_STATUSES.map((status) => (
              <label key={status} className={styles.filterCheckbox}>
                <input
                  type="checkbox"
                  checked={statusFilter.includes(status)}
                  onChange={() =>
                    setStatusFilter((current) => toggleValue(current, status))
                  }
                />
                {STATUS_LABELS[status]}
              </label>
            ))}
          </fieldset>

          {members.length > 0 && (
            <fieldset className={styles.filterGroup}>
              <legend>Assignee</legend>
              {members.map((member) => (
                <label key={member.id} className={styles.filterCheckbox}>
                  <input
                    type="checkbox"
                    checked={assigneeFilter.includes(member.id)}
                    onChange={() =>
                      setAssigneeFilter((current) =>
                        toggleValue(current, member.id),
                      )
                    }
                  />
                  {member.displayName}
                </label>
              ))}
            </fieldset>
          )}

          {labels.length > 0 && (
            <fieldset className={styles.filterGroup}>
              <legend>Label</legend>
              {labels.map((label) => (
                <label key={label.id} className={styles.filterCheckbox}>
                  <input
                    type="checkbox"
                    checked={labelFilter.includes(label.id)}
                    onChange={() =>
                      setLabelFilter((current) =>
                        toggleValue(current, label.id),
                      )
                    }
                  />
                  {label.name}
                </label>
              ))}
            </fieldset>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              className={styles.filtersClear}
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </section>

        {error && (
          <p role="alert" className={styles.boardError}>
            {error}
          </p>
        )}

        {loading && <p>Loading board…</p>}

        {!loading && board && totalCards === 0 && (
          <p className={styles.boardEmpty}>
            {hasActiveFilters
              ? "No issues match these filters."
              : "No issues yet — add one above."}
          </p>
        )}

        {board && (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className={styles.boardColumns}>
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
    </>
  );
}
