import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ISSUE_STATUSES, STATUS_LABELS } from "../lib/types";
import type { Issue, IssueStatus } from "../lib/types";
import styles from "./Card.module.css";

interface CardProps {
  issue: Issue;
  onMoveToColumn: (destinationStatus: IssueStatus) => void;
}

// Sep 17 (drag-and-drop) + Sep 19 (keyboard-accessible move action,
// D-22): every card is both draggable (via @dnd-kit's pointer +
// keyboard sensors, wired up in BoardPage) *and* carries an explicit
// "Move to" <select> - a native, fully keyboard- and
// screen-reader-operable control that doesn't depend on mastering
// drag gestures (pointer or dnd-kit's own keyboard sensor) at all.
// Both paths call the exact same moveCard function (useBoard.ts) -
// there's one move operation, triggered two ways.
export function Card({ issue, onMoveToColumn }: CardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id });

  const baseTransform = CSS.Transform.toString(transform);
  const style = {
    // A slight rotation + stronger shadow while actively dragging - a
    // small "lifted off the board" cue that reads better than opacity
    // alone, which just made the card look broken/half-loaded rather
    // than intentionally picked up.
    transform:
      isDragging && baseTransform
        ? `${baseTransform} rotate(2deg)`
        : baseTransform,
    transition,
    opacity: isDragging ? 0.85 : 1,
    boxShadow: isDragging ? "var(--shadow-md)" : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={styles.card}
      data-status={issue.status}
      {...attributes}
      {...listeners}
    >
      <p className={styles.cardTitle}>
        #{issue.number} {issue.title}
      </p>
      {issue.description && (
        <p className={styles.cardDescription}>{issue.description}</p>
      )}
      <label className={styles.cardMove}>
        Move to
        <select
          aria-label={`Move issue #${issue.number} to a different column`}
          value={issue.status}
          // A select's own click/keydown events would otherwise also
          // be picked up by dnd-kit's pointer sensor listeners spread
          // on this <li> - stopping propagation keeps "open the
          // dropdown" from being misread as "start a drag."
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) =>
            onMoveToColumn(event.target.value as IssueStatus)
          }
        >
          {ISSUE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}
