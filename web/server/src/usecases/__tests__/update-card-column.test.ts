import { describe, it, expect } from 'vitest';
import { createLink } from '@kanban-code/shared';
import type { Link } from '@kanban-code/shared';
import { updateCardColumn } from '../update-card-column.js';

/**
 * Tests for UpdateCardColumn use case.
 * Swift source: Sources/KanbanCodeCore/UseCases/UpdateCardColumn.swift (37 lines)
 * Spec: Section 7.8 "No unnecessary updatedAt"
 */

function makeLink(overrides: Partial<Link> = {}): Link {
  return createLink({ id: 'card_test', ...overrides });
}

describe('UpdateCardColumn', () => {
  it('updates column when it changes', () => {
    const pastDate = '2020-01-01T00:00:00.000Z';
    const link = makeLink({
      column: 'all_sessions',
      sessionLink: { sessionId: 's1' },
      updatedAt: pastDate,
    });

    const result = updateCardColumn(link, 'actively_working', false);

    expect(result.column).toBe('in_progress');
    expect(result.updatedAt).not.toBe(pastDate);
  });

  it('does NOT update updatedAt when column stays the same', () => {
    const link = makeLink({
      column: 'in_progress',
      sessionLink: { sessionId: 's1' },
    });
    const originalUpdatedAt = link.updatedAt;

    const result = updateCardColumn(link, 'actively_working', false);

    expect(result.column).toBe('in_progress');
    expect(result.updatedAt).toBe(originalUpdatedAt);
  });

  it('clears manuallyArchived when archived card becomes actively working', () => {
    const link = makeLink({
      column: 'all_sessions',
      manuallyArchived: true,
      sessionLink: { sessionId: 's1' },
    });

    const result = updateCardColumn(link, 'actively_working', false);

    expect(result.column).toBe('in_progress');
    expect(result.manuallyArchived).toBe(false);
  });

  it('keeps manuallyArchived when archived card is idle', () => {
    const link = makeLink({
      column: 'all_sessions',
      manuallyArchived: true,
      sessionLink: { sessionId: 's1' },
    });

    const result = updateCardColumn(link, 'idle_waiting', false);

    // Archive still wins -- stays allSessions
    expect(result.column).toBe('all_sessions');
    expect(result.manuallyArchived).toBe(true);
  });

  it('uses PR state from link.prLinks', () => {
    const link = makeLink({
      column: 'all_sessions',
      sessionLink: { sessionId: 's1' },
      prLinks: [{ number: 1, status: 'merged' }],
    });

    const result = updateCardColumn(link, null, false);

    expect(result.column).toBe('done');
  });

  it('moves to inReview when PR exists and idle', () => {
    const link = makeLink({
      column: 'all_sessions',
      sessionLink: { sessionId: 's1' },
      prLinks: [{ number: 1, status: 'review_needed' }],
    });

    const result = updateCardColumn(link, 'idle_waiting', false);

    expect(result.column).toBe('in_review');
  });

  it('uses hasWorktree for ended sessions', () => {
    const link = makeLink({
      column: 'all_sessions',
      sessionLink: { sessionId: 's1' },
    });

    const result = updateCardColumn(link, 'ended', true);

    expect(result.column).toBe('requires_attention');
  });

  it('does not mutate original link', () => {
    const link = makeLink({
      column: 'all_sessions',
      sessionLink: { sessionId: 's1' },
    });
    const originalColumn = link.column;

    updateCardColumn(link, 'actively_working', false);

    expect(link.column).toBe(originalColumn);
  });
});
