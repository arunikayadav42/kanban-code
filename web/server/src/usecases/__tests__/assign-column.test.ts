import { describe, it, expect } from 'vitest';
import { createLink } from '@kanban-code/shared';
import type { Link } from '@kanban-code/shared';
import { assignColumn } from '../assign-column.js';

/**
 * Port of Tests/KanbanCodeCoreTests/AssignColumnTests.swift (211 lines, 28 test cases)
 *
 * Swift .waiting column = TypeScript 'requires_attention'
 * Swift .inProgress = TypeScript 'in_progress'
 * Swift .allSessions = TypeScript 'all_sessions'
 * Swift .inReview = TypeScript 'in_review'
 */

function makeLink(overrides: Partial<Link> = {}): Link {
  return createLink({ id: 'card_test', ...overrides });
}

function makeSessionLink(overrides: Partial<Link> = {}): Link {
  return makeLink({ sessionLink: { sessionId: 's1' }, ...overrides });
}

describe('AssignColumn', () => {
  it('actively working overrides manual column', () => {
    const link = makeSessionLink({
      column: 'done',
      manualOverrides: { ...makeLink().manualOverrides, column: true },
    });
    expect(assignColumn(link, 'actively_working')).toBe('in_progress');
  });

  it('manual column override respected when not actively working', () => {
    const link = makeSessionLink({
      column: 'done',
      manualOverrides: { ...makeLink().manualOverrides, column: true },
    });
    expect(assignColumn(link, 'idle_waiting')).toBe('done');
  });

  it('manually archived + actively working -> inProgress (activity overrides archive)', () => {
    const link = makeSessionLink({
      column: 'all_sessions',
      manuallyArchived: true,
    });
    expect(assignColumn(link, 'actively_working')).toBe('in_progress');
  });

  it('manually archived + idle -> allSessions (archive still wins when not active)', () => {
    const link = makeSessionLink({
      column: 'all_sessions',
      manuallyArchived: true,
    });
    expect(assignColumn(link, 'idle_waiting')).toBe('all_sessions');
  });

  it('all PRs merged -> done', () => {
    const link = makeSessionLink({
      prLinks: [{ number: 1, status: 'merged' }],
    });
    expect(assignColumn(link, undefined, true, true)).toBe('done');
  });

  it('PR exists + idle -> inReview', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'idle_waiting', true)).toBe('in_review');
  });

  it('PR exists + needsAttention -> inReview (skips waiting for review workflow)', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'needs_attention', true)).toBe('in_review');
  });

  it('PR exists + actively working -> inProgress (not inReview)', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'actively_working', true)).toBe('in_progress');
  });

  it('actively working -> inProgress', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'actively_working')).toBe('in_progress');
  });

  it('needs attention -> waiting', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'needs_attention')).toBe('requires_attention');
  });

  it('idle with worktree -> waiting (Claude idle, not actively working)', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'idle_waiting', false, false, true)).toBe('requires_attention');
  });

  it('idle without worktree -> waiting', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(assignColumn(link, 'idle_waiting')).toBe('requires_attention');
  });

  it('idle without worktree, old -> waiting (idleWaiting always means waiting)', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 90_000_000).toISOString(),
    });
    expect(assignColumn(link, 'idle_waiting')).toBe('requires_attention');
  });

  it('ended with worktree -> waiting', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'ended', false, false, true)).toBe('requires_attention');
  });

  it('stale + recent -> waiting (falls through to recency check)', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(assignColumn(link, 'stale')).toBe('requires_attention');
  });

  it('stale + old -> allSessions', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 90_000_000).toISOString(),
    });
    expect(assignColumn(link, 'stale')).toBe('all_sessions');
  });

  it('ended without worktree, recent -> waiting', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(assignColumn(link, 'ended')).toBe('requires_attention');
  });

  it('ended without worktree, old -> allSessions', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 90_000_000).toISOString(),
    });
    expect(assignColumn(link, 'ended')).toBe('all_sessions');
  });

  it('GitHub issue without session -> backlog', () => {
    const link = makeLink({ source: 'github_issue' });
    expect(assignColumn(link)).toBe('backlog');
  });

  it('manual task without session -> backlog', () => {
    const link = makeLink({ source: 'manual' });
    expect(assignColumn(link)).toBe('backlog');
  });

  it('manual task with tmuxLink but no session -> inProgress (launching)', () => {
    const link = makeLink({
      source: 'manual',
      tmuxLink: { sessionName: 'test-project' },
    });
    expect(assignColumn(link)).toBe('in_progress');
  });

  it('manual task without tmuxLink or session -> backlog (not launched)', () => {
    const link = makeLink({ source: 'manual' });
    expect(assignColumn(link)).toBe('backlog');
  });

  it('no signals -> allSessions', () => {
    const link = makeSessionLink();
    expect(assignColumn(link)).toBe('all_sessions');
  });

  it('recently active session (within 24h) -> waiting (not inProgress)', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(assignColumn(link)).toBe('requires_attention');
  });

  it('session active 2h ago -> waiting', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 7200_000).toISOString(),
    });
    expect(assignColumn(link)).toBe('requires_attention');
  });

  it('only activelyWorking activity state -> inProgress', () => {
    // Without activityState, recent sessions should NOT be inProgress
    const recentLink = makeSessionLink({
      lastActivity: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(assignColumn(recentLink)).toBe('requires_attention');

    // With activityState = activelyWorking -> inProgress
    expect(assignColumn(recentLink, 'actively_working')).toBe('in_progress');
  });

  it('archive sets manuallyArchived -> allSessions regardless of recency', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 300_000).toISOString(),
      manuallyArchived: true,
    });
    expect(assignColumn(link)).toBe('all_sessions');
  });

  it('session active 25h ago -> allSessions (stale)', () => {
    const link = makeSessionLink({
      lastActivity: new Date(Date.now() - 90_000_000).toISOString(),
    });
    expect(assignColumn(link)).toBe('all_sessions');
  });

  // Additional: Manual backlog override is sticky
  it('manual backlog override is sticky even when actively working', () => {
    const link = makeSessionLink({
      column: 'backlog',
      manualOverrides: { ...makeLink().manualOverrides, column: true },
    });
    // Backlog override runs BEFORE activelyWorking check
    expect(assignColumn(link, 'actively_working')).toBe('backlog');
  });

  // PR + ended -> inReview
  it('PR exists + ended -> inReview', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'ended', true)).toBe('in_review');
  });

  // PR + stale -> inReview
  it('PR exists + stale -> inReview', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, 'stale', true)).toBe('in_review');
  });

  // Has worktree, no activity state -> waiting
  it('has worktree but no activity state -> waiting', () => {
    const link = makeSessionLink();
    expect(assignColumn(link, undefined, false, false, true)).toBe('requires_attention');
  });
});
