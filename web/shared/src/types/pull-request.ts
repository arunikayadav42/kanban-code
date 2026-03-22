/**
 * A GitHub pull request linked to a session via branch name.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/PullRequest.swift
 * Spec: Section 7.4 (Pull Request Tab)
 */

import type { PRStatus, ChecksStatus, CheckRun } from './pr-status.js';

export interface PullRequest {
  number: number;
  title: string;
  state: string; // "open", "closed", "merged"
  url: string;
  headRefName: string; // branch name
  reviewDecision?: string | null; // "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", ""
  checksStatus: ChecksStatus;
  unresolvedThreads: number;
  body?: string | null;
  approvalCount: number;
  checkRuns: CheckRun[];
  firstUnresolvedThreadURL?: string | null;
  mergeStateStatus?: string | null; // CLEAN, BLOCKED, DIRTY, BEHIND, DRAFT, UNSTABLE, HAS_HOOKS, UNKNOWN
}

/**
 * Derive unified PR status with priority ordering.
 * Mirrors Swift PullRequest.status computed property exactly.
 */
export function derivePRStatus(pr: PullRequest): PRStatus {
  if (pr.state === 'merged') return 'merged';
  if (pr.state === 'closed') return 'closed';
  if (pr.checksStatus === 'fail') return 'failing';
  if (pr.unresolvedThreads > 0) return 'unresolved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested';
  if (pr.reviewDecision === 'REVIEW_REQUIRED' || pr.reviewDecision === '' || pr.reviewDecision == null) {
    // Repos without required reviews return empty reviewDecision even with approvals
    if (pr.approvalCount > 0) {
      if (pr.checksStatus === 'pending') return 'pending_ci';
      return 'approved';
    }
    return 'review_needed';
  }
  if (pr.checksStatus === 'pending') return 'pending_ci';
  return 'approved';
}
