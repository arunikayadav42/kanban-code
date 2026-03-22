import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  DragState,
  createInitialDragState,
  ReorderIndicator,
  InvalidDropBadge,
  MergeBadge,
  KanbanDndContext,
} from '../DragAndDrop';
import type { Link } from '@kanban-code/shared';
import { createLink, mergeBlocked } from '@kanban-code/shared';

function makeLink(overrides: Partial<Link> & { id: string }): Link {
  return createLink({
    column: 'backlog',
    source: 'manual',
    projectPath: '/test/project',
    ...overrides,
  });
}

describe('DragState', () => {
  it('creates initial state with all fields null/false', () => {
    const state = createInitialDragState();
    expect(state.draggingCard).toBeNull();
    expect(state.sourceColumn).toBeNull();
    expect(state.mergeTargetId).toBeNull();
    expect(state.reorderTargetId).toBeNull();
    expect(state.reorderAbove).toBe(true);
  });

  it('DragState type matches expected shape', () => {
    const state: DragState = {
      draggingCard: makeLink({ id: 'test' }),
      sourceColumn: 'backlog',
      mergeTargetId: 'merge-target',
      reorderTargetId: 'reorder-target',
      reorderAbove: false,
    };
    expect(state.draggingCard?.id).toBe('test');
    expect(state.sourceColumn).toBe('backlog');
    expect(state.mergeTargetId).toBe('merge-target');
    expect(state.reorderTargetId).toBe('reorder-target');
    expect(state.reorderAbove).toBe(false);
  });
});

describe('Merge validation', () => {
  it('allows merging session card with worktree card', () => {
    const source = makeLink({ id: 'a', sessionLink: { sessionId: 's1' } });
    const target = makeLink({
      id: 'b',
      worktreeLink: { path: '/work', branch: 'feat' },
    });
    expect(mergeBlocked(source, target)).toBeNull();
  });

  it('blocks merging two cards with sessions', () => {
    const source = makeLink({ id: 'a', sessionLink: { sessionId: 's1' } });
    const target = makeLink({ id: 'b', sessionLink: { sessionId: 's2' } });
    expect(mergeBlocked(source, target)).toContain('both cards have sessions');
  });

  it('blocks merging two cards with terminals', () => {
    const source = makeLink({ id: 'a', tmuxLink: { sessionName: 't1' } });
    const target = makeLink({ id: 'b', tmuxLink: { sessionName: 't2' } });
    expect(mergeBlocked(source, target)).toContain('both cards have terminals');
  });

  it('blocks merging a card with itself', () => {
    const card = makeLink({ id: 'same' });
    expect(mergeBlocked(card, card)).toContain('Cannot merge a card with itself');
  });
});

describe('ReorderIndicator', () => {
  it('renders the indicator line', () => {
    const { container } = render(<ReorderIndicator />);
    const indicator = container.querySelector('[data-testid="reorder-indicator"]');
    expect(indicator).not.toBeNull();
  });
});

describe('InvalidDropBadge', () => {
  it('renders "Not allowed" text', () => {
    render(<InvalidDropBadge />);
    expect(screen.getByText('Not allowed')).toBeDefined();
  });
});

describe('MergeBadge', () => {
  it('renders "Merge" text', () => {
    render(<MergeBadge />);
    expect(screen.getByText('Merge')).toBeDefined();
  });
});

describe('KanbanDndContext', () => {
  it('renders children', () => {
    render(
      <KanbanDndContext
        onMoveCard={vi.fn()}
        onMergeCards={vi.fn()}
        onReorderCard={vi.fn()}
      >
        <div data-testid="child">Hello</div>
      </KanbanDndContext>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });
});
