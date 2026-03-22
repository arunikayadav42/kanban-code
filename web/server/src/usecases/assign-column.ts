import type { Link, KanbanCodeColumn, ActivityState } from '@kanban-code/shared';

/**
 * Determines which Kanban column a link should be in based on its state.
 * Respects manual overrides -- if the user dragged a card to a column, keep it there.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/AssignColumn.swift (107 lines)
 * Spec: Section 7.8 (Card Lifecycle Invariants)
 *
 * 12-rule decision tree, evaluated top-to-bottom:
 *  1. Manual backlog override (sticky)
 *  2. activelyWorking -> inProgress (even if archived)
 *  3. Archived -> allSessions
 *  4. All PRs done -> done
 *  5. Manual column override -> current column
 *  6. Has PR + idle/ended/stale/needsAttention -> inReview
 *  7. Activity state mapping
 *  8. GitHub issue without session -> backlog
 *  9. Manual task without session: tmuxLink (not shell-only) -> inProgress, else backlog
 * 10. Has worktree -> waiting
 * 11. Recently active (<24h) -> waiting
 * 12. Default -> allSessions
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function assignColumn(
  link: Link,
  activityState?: ActivityState | null,
  hasPR: boolean = false,
  allPRsDone: boolean = false,
  hasWorktree: boolean = false,
): KanbanCodeColumn {
  // Rule 1: Manual backlog override is sticky.
  // Only resumeCard/launchCard (which clear manualOverrides.column) can move it out.
  // This check must run BEFORE .activelyWorking to prevent activity from
  // corrupting the backlog override.
  if (link.manualOverrides.column && link.column === 'backlog') {
    return 'backlog';
  }

  // Rule 2: Actively working always shows in progress -- even if manually archived.
  if (activityState === 'actively_working') {
    return 'in_progress';
  }

  // Rule 3: Archive wins over everything else
  if (link.manuallyArchived) {
    return 'all_sessions';
  }

  // Rule 4: Terminal PR state
  if (allPRsDone) {
    return 'done';
  }

  // Rule 5: Manual drag override (non-terminal)
  if (link.manualOverrides.column) {
    return link.column;
  }

  // Rule 6: PR exists and session not actively working -> inReview
  // This skips Waiting when addressing review feedback
  if (
    hasPR &&
    activityState != null &&
    (activityState === 'needs_attention' ||
     activityState === 'idle_waiting' ||
     activityState === 'ended' ||
     activityState === 'stale')
  ) {
    return 'in_review';
  }

  // Rule 7: Activity-based assignment
  if (activityState != null) {
    switch (activityState as ActivityState) {
      case 'actively_working':
        return 'in_progress'; // Already handled above, but keep for exhaustive switch
      case 'needs_attention':
        return 'requires_attention';
      case 'idle_waiting':
        // Claude is idle/waiting for user -- that's Waiting, not In Progress.
        return 'requires_attention';
      case 'ended':
        if (hasWorktree) return 'requires_attention';
        // No worktree: fall through to recency check below
        break;
      case 'stale':
        break; // No hook data: fall through to recency check below
    }
  }

  // Rule 8: GitHub issue source without a session yet -> backlog
  if (link.source === 'github_issue' && link.sessionLink == null) {
    return 'backlog';
  }

  // Rule 9: Manual task without a session yet -> backlog
  // BUT if tmuxLink is set and NOT shell-only, it's being actively launched -> stay in progress
  if (link.source === 'manual' && link.sessionLink == null) {
    if (link.tmuxLink != null && link.tmuxLink.isShellOnly !== true) {
      return 'in_progress';
    }
    return 'backlog';
  }

  // Rule 10: Has worktree -> at least waiting
  if (hasWorktree) {
    return 'requires_attention';
  }

  // Rule 11: Recently active (within 24h) -> waiting
  if (link.lastActivity != null) {
    const hoursSinceActivity = Date.now() - new Date(link.lastActivity).getTime();
    if (hoursSinceActivity < TWENTY_FOUR_HOURS_MS) {
      return 'requires_attention';
    }
  }

  // Rule 12: Default -> allSessions
  return 'all_sessions';
}
