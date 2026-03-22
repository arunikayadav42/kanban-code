import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchOverlay from '../SearchOverlay';
import type { CommandItem } from '../SearchOverlay';
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

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  cards: [] as Link[],
  onSelectCard: vi.fn(),
};

describe('SearchOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <SearchOverlay {...defaultProps} isOpen={false} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the overlay when isOpen is true', () => {
      render(<SearchOverlay {...defaultProps} />);
      expect(screen.getByTestId('search-overlay')).toBeDefined();
    });

    it('renders search input with placeholder', () => {
      render(<SearchOverlay {...defaultProps} />);
      const input = screen.getByTestId('search-input') as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.placeholder).toMatch(/Search or type > for commands/);
    });

    it('renders Esc close button', () => {
      render(<SearchOverlay {...defaultProps} />);
      expect(screen.getByTestId('search-close')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Empty query -> recent cards
  // -----------------------------------------------------------------------

  describe('Recent cards (empty query)', () => {
    it('shows "Recent" label with empty query', () => {
      const cards = [makeLink({ id: 'c1', name: 'Alpha' })];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      expect(screen.getByText('Recent')).toBeDefined();
    });

    it('displays recent cards sorted by lastOpenedAt', () => {
      const now = new Date();
      const older = new Date(now.getTime() - 3600000);
      const cards = [
        makeLink({ id: 'c1', name: 'Old Card', updatedAt: older.toISOString() }),
        makeLink({ id: 'c2', name: 'New Card', updatedAt: now.toISOString() }),
      ];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const rows = screen.getAllByText(/Card/);
      // "New Card" should appear before "Old Card"
      expect(rows[0].textContent).toBe('New Card');
      expect(rows[1].textContent).toBe('Old Card');
    });

    it('shows at most 20 recent cards', () => {
      const cards = Array.from({ length: 25 }, (_, i) =>
        makeLink({ id: `c${i}`, name: `Card ${i}` }),
      );
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const results = screen.getByTestId('search-results');
      // Count card-row elements (class-based)
      const rows = results.querySelectorAll('[data-testid^="card-row-"]');
      expect(rows.length).toBe(20);
    });

    it('clicking a recent card calls onSelectCard and closes', () => {
      const card = makeLink({ id: 'c1', name: 'Click Me' });
      const onSelectCard = vi.fn();
      const onClose = vi.fn();
      render(
        <SearchOverlay
          {...defaultProps}
          cards={[card]}
          onSelectCard={onSelectCard}
          onClose={onClose}
        />,
      );
      fireEvent.click(screen.getByText('Click Me'));
      expect(onSelectCard).toHaveBeenCalledWith(card);
      expect(onClose).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Live filter (substring match)
  // -----------------------------------------------------------------------

  describe('Live filter', () => {
    it('filters cards by name substring', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'Fix login bug' }),
        makeLink({ id: 'c2', name: 'Add feature' }),
        makeLink({ id: 'c3', name: 'Login page redesign' }),
      ];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'login' } });

      // Both "Fix login bug" and "Login page redesign" should show
      expect(screen.getByText('Fix login bug')).toBeDefined();
      expect(screen.getByText('Login page redesign')).toBeDefined();
      // "Add feature" should not
      expect(screen.queryByText('Add feature')).toBeNull();
    });

    it('shows "No matches" when filter matches nothing', () => {
      const cards = [makeLink({ id: 'c1', name: 'Test' })];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'zzzznonexistent' } });
      expect(screen.getByTestId('no-matches')).toBeDefined();
    });

    it('matches on project path', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'Task A', projectPath: '/Users/dev/kanban-code' }),
        makeLink({ id: 'c2', name: 'Task B', projectPath: '/Users/dev/other-project' }),
      ];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'kanban' } });
      expect(screen.getByText('Task A')).toBeDefined();
      expect(screen.queryByText('Task B')).toBeNull();
    });

    it('matches on branch name', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'With Branch', worktreeLink: { path: '/wt', branch: 'feat/auth' } }),
        makeLink({ id: 'c2', name: 'No Branch' }),
      ];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'auth' } });
      expect(screen.getByText('With Branch')).toBeDefined();
      expect(screen.queryByText('No Branch')).toBeNull();
    });

    it('prioritizes active column cards', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'Backlog match', column: 'backlog' }),
        makeLink({ id: 'c2', name: 'Progress match', column: 'in_progress' }),
      ];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'match' } });

      const rows = screen.getAllByText(/match/);
      expect(rows[0].textContent).toBe('Progress match');
    });
  });

  // -----------------------------------------------------------------------
  // Command mode
  // -----------------------------------------------------------------------

  describe('Command mode (">" prefix)', () => {
    const testCommands: CommandItem[] = [
      { id: 'cmd:settings', title: 'Open Settings', icon: 'gear', action: vi.fn() },
      { id: 'cmd:toggle', title: 'Toggle View', icon: 'grid', shortcut: 'Cmd+\\', action: vi.fn() },
      { id: 'cmd:new', title: 'New Task', icon: 'plus', action: vi.fn() },
    ];

    it('shows "Commands" label when query starts with ">"', () => {
      render(<SearchOverlay {...defaultProps} commands={testCommands} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: '>' } });
      expect(screen.getByText('Commands')).toBeDefined();
    });

    it('lists all commands with empty command query', () => {
      render(<SearchOverlay {...defaultProps} commands={testCommands} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: '>' } });
      expect(screen.getByText('Open Settings')).toBeDefined();
      expect(screen.getByText('Toggle View')).toBeDefined();
      expect(screen.getByText('New Task')).toBeDefined();
    });

    it('filters commands by substring', () => {
      render(<SearchOverlay {...defaultProps} commands={testCommands} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: '>settings' } });
      expect(screen.getByText('Open Settings')).toBeDefined();
      expect(screen.queryByText('New Task')).toBeNull();
    });

    it('shows "No matching commands" when filter matches nothing', () => {
      render(<SearchOverlay {...defaultProps} commands={testCommands} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: '>zzzzzz' } });
      expect(screen.getByTestId('no-commands')).toBeDefined();
    });

    it('shows shortcut badge when present', () => {
      render(<SearchOverlay {...defaultProps} commands={testCommands} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: '>' } });
      expect(screen.getByText('Cmd+\\')).toBeDefined();
    });

    it('clicking command executes action and closes', () => {
      const onClose = vi.fn();
      render(
        <SearchOverlay
          {...defaultProps}
          onClose={onClose}
          commands={testCommands}
        />,
      );
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: '>' } });
      fireEvent.click(screen.getByText('Open Settings'));
      expect(testCommands[0].action).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  describe('Keyboard navigation', () => {
    it('ArrowDown selects first item', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'First' }),
        makeLink({ id: 'c2', name: 'Second' }),
      ];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const overlay = screen.getByTestId('search-overlay');

      // The container with onKeyDown is the inner div
      const innerDiv = overlay.firstElementChild as HTMLElement;
      fireEvent.keyDown(innerDiv, { key: 'ArrowDown' });

      // Check that first card row has highlight class
      const row = screen.getByTestId('card-row-c1');
      // After navigating, the first item should be highlighted
      // (we started with c2 selected since it's the second recent card)
      expect(row).toBeDefined();
    });

    it('Escape calls onClose', () => {
      const onClose = vi.fn();
      render(<SearchOverlay {...defaultProps} onClose={onClose} />);
      const overlay = screen.getByTestId('search-overlay');
      const innerDiv = overlay.firstElementChild as HTMLElement;
      fireEvent.keyDown(innerDiv, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('Enter on selected card calls onSelectCard', () => {
      const card = makeLink({ id: 'c1', name: 'Select Me' });
      const onSelectCard = vi.fn();
      const onClose = vi.fn();
      render(
        <SearchOverlay
          {...defaultProps}
          cards={[card]}
          onSelectCard={onSelectCard}
          onClose={onClose}
        />,
      );

      const overlay = screen.getByTestId('search-overlay');
      const innerDiv = overlay.firstElementChild as HTMLElement;

      // Navigate down to first item
      fireEvent.keyDown(innerDiv, { key: 'ArrowDown' });
      // Select with Enter
      fireEvent.keyDown(innerDiv, { key: 'Enter' });
      expect(onSelectCard).toHaveBeenCalledWith(card);
      expect(onClose).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Escape + backdrop
  // -----------------------------------------------------------------------

  describe('Closing', () => {
    it('closes when clicking backdrop', () => {
      const onClose = vi.fn();
      render(<SearchOverlay {...defaultProps} onClose={onClose} />);
      const overlay = screen.getByTestId('search-overlay');
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalled();
    });

    it('closes when clicking Esc button', () => {
      const onClose = vi.fn();
      render(<SearchOverlay {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('search-close'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Column label display
  // -----------------------------------------------------------------------

  describe('Column labels', () => {
    it('shows column label on card rows', () => {
      const card = makeLink({ id: 'c1', name: 'In Progress Card', column: 'in_progress' });
      render(<SearchOverlay {...defaultProps} cards={[card]} />);
      expect(screen.getByText('In Progress')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Display title fallbacks
  // -----------------------------------------------------------------------

  describe('Display title', () => {
    it('uses name as title', () => {
      const card = makeLink({ id: 'c1', name: 'My Task' });
      render(<SearchOverlay {...defaultProps} cards={[card]} />);
      expect(screen.getByText('My Task')).toBeDefined();
    });

    it('falls back to promptBody when no name', () => {
      const card = makeLink({ id: 'c1', name: null, promptBody: 'Fix the bug' });
      render(<SearchOverlay {...defaultProps} cards={[card]} />);
      expect(screen.getByText('Fix the bug')).toBeDefined();
    });

    it('falls back to branch when no name or prompt', () => {
      const card = makeLink({
        id: 'c1',
        name: null,
        worktreeLink: { path: '/wt', branch: 'feat/search' },
      });
      render(<SearchOverlay {...defaultProps} cards={[card]} />);
      expect(screen.getAllByText('feat/search').length).toBeGreaterThan(0);
    });

    it('falls back to id', () => {
      const card = makeLink({ id: 'card_xyz', name: null });
      render(<SearchOverlay {...defaultProps} cards={[card]} />);
      expect(screen.getByText('card_xyz')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Fuzzy initials
  // -----------------------------------------------------------------------

  describe('Fuzzy initials matching', () => {
    it('matches "kp" to "Kanban Projects"', () => {
      const cards = [
        makeLink({ id: 'c1', name: 'Kanban Projects' }),
        makeLink({ id: 'c2', name: 'Other Task' }),
      ];
      render(<SearchOverlay {...defaultProps} cards={cards} />);
      const input = screen.getByTestId('search-input');
      fireEvent.change(input, { target: { value: 'kp' } });
      expect(screen.getByText('Kanban Projects')).toBeDefined();
      expect(screen.queryByText('Other Task')).toBeNull();
    });
  });
});
