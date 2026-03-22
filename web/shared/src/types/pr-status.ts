/**
 * Unified PR status with priority ordering (highest urgency first).
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/PRStatus.swift
 * Spec: Section 7.4 (Pull Request Tab), Section 7.8 (Card Merge Invariants)
 */

export type PRStatus =
  | 'failing'
  | 'unresolved'
  | 'changes_requested'
  | 'review_needed'
  | 'pending_ci'
  | 'approved'
  | 'merged'
  | 'closed';

/** Priority for ordering: lower = higher urgency. Matches Swift Comparable. */
export function getPRStatusPriority(status: PRStatus): number {
  switch (status) {
    case 'failing': return 0;
    case 'unresolved': return 1;
    case 'changes_requested': return 2;
    case 'review_needed': return 3;
    case 'pending_ci': return 4;
    case 'approved': return 5;
    case 'merged': return 6;
    case 'closed': return 7;
  }
}

/** Compare two PR statuses: returns negative if a is higher urgency than b. */
export function comparePRStatus(a: PRStatus, b: PRStatus): number {
  return getPRStatusPriority(a) - getPRStatusPriority(b);
}

/** CI check aggregation result. */
export type ChecksStatus = 'pass' | 'fail' | 'pending' | 'none';

/** Individual CI check run status. */
export type CheckRunStatus = 'queued' | 'in_progress' | 'completed';

/** Individual CI check run conclusion. */
export type CheckRunConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'skipped';

/** An individual CI check run (from GitHub Actions CheckRun or commit StatusContext). */
export interface CheckRun {
  name: string;
  status: CheckRunStatus;
  conclusion: CheckRunConclusion | null;
}
