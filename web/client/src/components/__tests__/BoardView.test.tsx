import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import BoardView from '../BoardView';
import { useBoardStore } from '../../store/index';
import type { Link } from '@kanban-code/shared';
import { createLink } from '@kanban-code/shared';

function makeLink(overrides: Partial<Link> & { id: string }): Link {
  return createLink({
    column: 'backlog',
    source: 'manual',
    projectPath: '/test/project',
    ...overrides,
  });
}

/** Reset store state before each test. */
function resetStore(links: Record<string, Link> = {}, error: string | null = null) {
  const store = useBoardStore.getState();
  useBoardStore.setState({
    links,
    selectedCardId: null,
    error,
    isLoading: false,
    isConnected: true,
    paletteOpen: false,
    detailExpanded: false,
    boardViewMode: 'kanban',
  });
}

describe('BoardView', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('Empty state', () => {
    it('shows empty state when no links exist', () => {
      render(<BoardView />);
      expect(screen.getByTestId('empty-state')).toBeDefined();
      expect(screen.getByText('No sessions found')).toBeDefined();
      expect(
        screen.getByText('Create a new task or start a Claude session to get going.'),
      ).toBeDefined();
    });

    it('shows New Task button when onNewTask is provided', () => {
      const onNewTask = vi.fn();
      render(<BoardView onNewTask={onNewTask} />);
      const btn = screen.getByTestId('new-task-button');
      expect(btn).toBeDefined();
      fireEvent.click(btn);
      expect(onNewTask).toHaveBeenCalledOnce();
    });

    it('does not show empty state when links exist', () => {
      const link = makeLink({ id: 'c1', name: 'Task 1' });
      resetStore({ c1: link });
      render(<BoardView />);
      expect(screen.queryByTestId('empty-state')).toBeNull();
    });
  });

  describe('Columns rendering', () => {
    it('renders all default columns', () => {
      const link = makeLink({ id: 'c1', name: 'Task', column: 'backlog' });
      resetStore({ c1: link });
      render(<BoardView />);
      expect(screen.getByText('Backlog')).toBeDefined();
      expect(screen.getByText('In Progress')).toBeDefined();
      expect(screen.getByText('Waiting')).toBeDefined();
      expect(screen.getByText('In Review')).toBeDefined();
      expect(screen.getByText('Done')).toBeDefined();
      expect(screen.getByText('All Sessions')).toBeDefined();
    });

    it('renders only specified visible columns', () => {
      const link = makeLink({ id: 'c1', name: 'Task', column: 'backlog' });
      resetStore({ c1: link });
      render(<BoardView visibleColumns={['backlog', 'in_progress']} />);
      expect(screen.getByText('Backlog')).toBeDefined();
      expect(screen.getByText('In Progress')).toBeDefined();
      expect(screen.queryByText('Done')).toBeNull();
    });

    it('distributes cards into correct columns', () => {
      const backlogCard = makeLink({ id: 'c1', name: 'Backlog task', column: 'backlog' });
      const progressCard = makeLink({ id: 'c2', name: 'Progress task', column: 'in_progress' });
      resetStore({ c1: backlogCard, c2: progressCard });
      render(<BoardView />);
      expect(screen.getByText('Backlog task')).toBeDefined();
      expect(screen.getByText('Progress task')).toBeDefined();
    });
  });

  describe('Error banner', () => {
    it('shows error banner when error exists in store', () => {
      resetStore({}, 'Something went wrong');
      render(<BoardView />);
      const banner = screen.getByTestId('error-banner');
      expect(banner).toBeDefined();
      expect(screen.getByText('Something went wrong')).toBeDefined();
    });

    it('shows dismiss button that clears the error', () => {
      resetStore({}, 'Test error');
      render(<BoardView />);
      const dismissBtn = screen.getByText('Dismiss');
      expect(dismissBtn).toBeDefined();

      act(() => {
        fireEvent.click(dismissBtn);
      });

      expect(useBoardStore.getState().error).toBeNull();
    });

    it('does not show error banner when no error', () => {
      resetStore();
      render(<BoardView />);
      expect(screen.queryByTestId('error-banner')).toBeNull();
    });
  });

  describe('Board layout', () => {
    it('renders board-view testid', () => {
      render(<BoardView />);
      expect(screen.getByTestId('board-view')).toBeDefined();
    });

    it('renders horizontal scrollable layout', () => {
      const link = makeLink({ id: 'c1', name: 'Task' });
      resetStore({ c1: link });
      const { container } = render(<BoardView />);
      const boardView = container.querySelector('[data-testid="board-view"]') as HTMLElement;
      expect(boardView).not.toBeNull();
    });
  });

  describe('Refresh backlog', () => {
    it('passes onRefreshBacklog only to backlog column', () => {
      const link = makeLink({ id: 'c1', name: 'Task', column: 'backlog' });
      resetStore({ c1: link });
      const onRefresh = vi.fn();
      render(
        <BoardView
          visibleColumns={['backlog', 'in_progress']}
          onRefreshBacklog={onRefresh}
        />,
      );
      // The backlog column should have the refresh button
      const refreshBtn = screen.getByRole('button', { name: /refresh/i });
      expect(refreshBtn).toBeDefined();
    });
  });

  describe('Card selection', () => {
    it('connects card selection to store', () => {
      const link = makeLink({ id: 'c1', name: 'Selectable', column: 'backlog' });
      resetStore({ c1: link });
      render(<BoardView visibleColumns={['backlog']} />);
      // Click on the card text
      fireEvent.click(screen.getByText('Selectable'));
      expect(useBoardStore.getState().selectedCardId).toBe('c1');
    });
  });
});
