import type { Link, ActivityState } from '@kanban-code/shared';
import { getAllPRsDone } from '@kanban-code/shared';
import { assignColumn } from './assign-column.js';

/**
 * Updates a link's column based on current activity state, PR status, and worktree existence.
 * Wraps assignColumn with mutation logic.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/UpdateCardColumn.swift (37 lines)
 * Spec: Section 7.8 "No unnecessary updatedAt"
 *
 * Returns a new Link (immutable update) with column and flags adjusted.
 * Only sets updatedAt if the column actually changed.
 */
export function updateCardColumn(
  link: Link,
  activityState: ActivityState | null | undefined,
  hasWorktree: boolean,
): Link {
  const hasPR = (link.prLinks ?? []).length > 0;
  const allPRsDone = getAllPRsDone(link);

  const newColumn = assignColumn(
    link,
    activityState,
    hasPR,
    allPRsDone,
    hasWorktree,
  );

  let updated = { ...link };

  // If an archived card becomes actively working, clear the archive flag
  // so it stays in waiting (not allSessions) once work stops.
  if (link.manuallyArchived && newColumn === 'in_progress') {
    updated = { ...updated, manuallyArchived: false };
  }

  if (newColumn !== link.column) {
    updated = {
      ...updated,
      column: newColumn,
      updatedAt: new Date().toISOString(),
    };
  }

  return updated;
}
