import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { STATUS_LABELS } from "../lib/types";
import type { Issue, IssueStatus } from "../lib/types";
import { Card } from "./Card";
import styles from "./Column.module.css";

interface ColumnProps {
  status: IssueStatus;
  issues: Issue[];
  onMoveToColumn: (issueId: string, destinationStatus: IssueStatus) => void;
}

// One board column = one droppable container, its id *is* the status
// value - BoardPage's onDragEnd resolves a drop target against either
// a card id or a column id directly, no extra lookup table needed.
export function Column({ status, issues, onMoveToColumn }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <section className={styles.column} data-column-status={status}>
      <h2>
        {STATUS_LABELS[status]}{" "}
        <span className={styles.columnCount}>{issues.length}</span>
      </h2>
      <SortableContext
        items={issues.map((issue) => issue.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul ref={setNodeRef} className={styles.columnList}>
          {issues.map((issue) => (
            <Card
              key={issue.id}
              issue={issue}
              onMoveToColumn={(destination) =>
                onMoveToColumn(issue.id, destination)
              }
            />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}
