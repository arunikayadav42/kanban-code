import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ListBoardView from '../ListBoardView';
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

function resetStore(links: Record<string, Link> = {}, error: string | null = null) {
  useBoardStore.setState({
    links,
    selectedCardId: null,
    error,
    isLoading: false,
    isConnected: true,
    paletteOpen: false,
    detailExpanded: false,
    boardViewMode: 'list',
  });
}

/** Clear localStorage before each test. */
beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('ListBoardView', () => {
  describe('Empty state', () => {
    it('shows empty state when no links', () => {
      render(<ListBoardView />);
      expect(screen.getByTestId('empty-state')).toBeDefined();
      expect(screen.getByText('No sessions found')).toBeDefined();
    });

    it('shows New Task button', () => {
      const onNewTask = vi.fn();
      render(<ListBoardView onNewTask={onNewTask} />);
      const btn = screen.getByTestId('new-task-button');
      fireEvent.click(btn);
      expect(onNewTask).toHaveBeenCalledOnce();
    });

    it('does not show empty state when links exist', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Card' }) });
      render(<ListBoardView />);
      expect(screen.queryByTestId('empty-state')).toBeNull();
    });
  });

  describe('Section rendering', () => {
    it('renders section headers for all columns', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'X', column: 'backlog' }) });
      render(<ListBoardView />);
      expect(screen.getByText('Backlog')).toBeDefined();
      expect(screen.getByText('In Progress')).toBeDefined();
      expect(screen.getByText('Waiting')).toBeDefined();
      expect(screen.getByText('In Review')).toBeDefined();
      expect(screen.getByText('Done')).toBeDefined();
      expect(screen.getByText('All Sessions')).toBeDefined();
    });

    it('renders only specified visible columns', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'X', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog', 'done']} />);
      expect(screen.getByText('Backlog')).toBeDefined();
      expect(screen.getByText('Done')).toBeDefined();
      expect(screen.queryByText('In Progress')).toBeNull();
    });

    it('shows cards in correct sections', () => {
      resetStore({
        c1: makeLink({ id: 'c1', name: 'Backlog task', column: 'backlog' }),
        c2: makeLink({ id: 'c2', name: 'Review task', column: 'in_review' }),
      });
      render(<ListBoardView />);
      expect(screen.getByText('Backlog task')).toBeDefined();
      expect(screen.getByText('Review task')).toBeDefined();
    });

    it('shows count badge on section headers', () => {
      resetStore({
        c1: makeLink({ id: 'c1', name: 'A', column: 'backlog' }),
        c2: makeLink({ id: 'c2', name: 'B', column: 'backlog' }),
      });
      render(<ListBoardView visibleColumns={['backlog']} />);
      // Should have "2" as the count
      expect(screen.getByText('2')).toBeDefined();
    });
  });

  describe('Collapsible sections', () => {
    it('sections are expanded by default', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Visible card', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog']} />);
      expect(screen.getByText('Visible card')).toBeDefined();
    });

    it('clicking header toggles section collapse', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Collapsible card', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog']} />);

      // Card is visible initially
      expect(screen.getByText('Collapsible card')).toBeDefined();

      // Click header to collapse
      const header = screen.getByTestId('section-header-backlog');
      fireEvent.click(header);

      // Card should be hidden
      expect(screen.queryByText('Collapsible card')).toBeNull();
    });

    it('clicking collapsed header expands the section', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Toggle card', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog']} />);

      const header = screen.getByTestId('section-header-backlog');

      // Collapse
      fireEvent.click(header);
      expect(screen.queryByText('Toggle card')).toBeNull();

      // Expand
      fireEvent.click(header);
      expect(screen.getByText('Toggle card')).toBeDefined();
    });

    it('persists collapsed state in localStorage', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Card', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog']} />);

      // Collapse backlog
      fireEvent.click(screen.getByTestId('section-header-backlog'));

      // Check localStorage
      const stored = localStorage.getItem('listBoardCollapsedColumns');
      expect(stored).toContain('backlog');
    });
  });

  describe('Empty section placeholder', () => {
    it('shows "No cards" placeholder for empty sections', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Card', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog', 'in_progress']} />);
      const emptySection = screen.getByTestId('empty-section-in_progress');
      expect(emptySection).toBeDefined();
      expect(screen.getByText('No cards')).toBeDefined();
    });
  });

  describe('Error banner', () => {
    it('shows error when store has error', () => {
      resetStore({}, 'Network error');
      render(<ListBoardView />);
      expect(screen.getByTestId('error-banner')).toBeDefined();
      expect(screen.getByText('Network error')).toBeDefined();
    });

    it('dismiss button clears the error', () => {
      resetStore({}, 'Error msg');
      render(<ListBoardView />);
      act(() => {
        fireEvent.click(screen.getByText('Dismiss'));
      });
      expect(useBoardStore.getState().error).toBeNull();
    });
  });

  describe('Card selection', () => {
    it('selecting a card updates store', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Click me', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog']} />);
      fireEvent.click(screen.getByText('Click me'));
      expect(useBoardStore.getState().selectedCardId).toBe('c1');
    });

    it('clicking selected card deselects it', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Toggle select', column: 'backlog' }) });
      render(<ListBoardView visibleColumns={['backlog']} />);

      // Select
      fireEvent.click(screen.getByText('Toggle select'));
      expect(useBoardStore.getState().selectedCardId).toBe('c1');

      // Deselect
      fireEvent.click(screen.getByText('Toggle select'));
      expect(useBoardStore.getState().selectedCardId).toBeNull();
    });
  });

  describe('Layout', () => {
    it('renders list-board-view testid', () => {
      render(<ListBoardView />);
      expect(screen.getByTestId('list-board-view')).toBeDefined();
    });
  });

  describe('Refresh backlog', () => {
    it('shows refresh button for backlog section', () => {
      resetStore({ c1: makeLink({ id: 'c1', name: 'Card', column: 'backlog' }) });
      const onRefresh = vi.fn();
      render(
        <ListBoardView
          visibleColumns={['backlog', 'in_progress']}
          onRefreshBacklog={onRefresh}
        />,
      );
      const refreshBtn = screen.getByRole('button', { name: /refresh/i });
      expect(refreshBtn).toBeDefined();

      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledOnce();
    });
  });
});
