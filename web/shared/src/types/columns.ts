/**
 * The columns on the Kanban board, in display order.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/KanbanCodeColumn.swift
 * Spec: Section 7.4 (Card Detail Side Panel), Section 7.8 (Card Lifecycle Invariants)
 *
 * NOTE: Raw values match the Swift enum's rawValue strings exactly.
 * These are used for JSON serialization (links.json column field).
 */

export type KanbanCodeColumn =
  | 'backlog'
  | 'in_progress'
  | 'requires_attention'
  | 'in_review'
  | 'done'
  | 'all_sessions';

export const ALL_COLUMNS: readonly KanbanCodeColumn[] = [
  'backlog',
  'in_progress',
  'requires_attention',
  'in_review',
  'done',
  'all_sessions',
] as const;

export function getColumnDisplayName(column: KanbanCodeColumn): string {
  switch (column) {
    case 'backlog': return 'Backlog';
    case 'in_progress': return 'In Progress';
    case 'requires_attention': return 'Waiting';
    case 'in_review': return 'In Review';
    case 'done': return 'Done';
    case 'all_sessions': return 'All Sessions';
  }
}

export function getAllowsBoardTaskCreation(column: KanbanCodeColumn): boolean {
  return column !== 'all_sessions';
}
