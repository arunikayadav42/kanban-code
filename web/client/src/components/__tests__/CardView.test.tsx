import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CardView from '../CardView';
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

describe('CardView', () => {
  describe('Title', () => {
    it('renders card name as title', () => {
      const link = makeLink({ id: 'c1', name: 'Fix login bug' });
      render(<CardView link={link} />);
      expect(screen.getByText('Fix login bug')).toBeDefined();
    });

    it('falls back to promptBody when no name', () => {
      const link = makeLink({
        id: 'c2',
        name: null,
        promptBody: 'Implement auth flow',
      });
      render(<CardView link={link} />);
      expect(screen.getByText('Implement auth flow')).toBeDefined();
    });

    it('falls back to branch when no name or prompt', () => {
      const link = makeLink({
        id: 'c3',
        name: null,
        worktreeLink: { path: '/wt', branch: 'feat/auth' },
      });
      render(<CardView link={link} />);
      expect(screen.getAllByText('feat/auth').length).toBeGreaterThan(0);
    });

    it('falls back to id when nothing else available', () => {
      const link = makeLink({ id: 'card_abc123', name: null });
      render(<CardView link={link} />);
      expect(screen.getByText('card_abc123')).toBeDefined();
    });
  });

  describe('Project and branch labels', () => {
    it('shows project name from path', () => {
      const link = makeLink({
        id: 'c4',
        name: 'Task',
        projectPath: '/Users/dev/my-project',
      });
      render(<CardView link={link} />);
      expect(screen.getByText('my-project')).toBeDefined();
    });

    it('shows branch label', () => {
      const link = makeLink({
        id: 'c5',
        name: 'Task',
        worktreeLink: { path: '/wt', branch: 'main' },
      });
      render(<CardView link={link} />);
      expect(screen.getByText('main')).toBeDefined();
    });
  });

  describe('Play button for backlog', () => {
    it('shows play button for backlog cards', () => {
      const link = makeLink({ id: 'c6', name: 'Task', column: 'backlog' });
      const onStart = vi.fn();
      render(<CardView link={link} onStart={onStart} />);
      const playBtn = screen.getByRole('button', { name: /start/i });
      expect(playBtn).toBeDefined();
    });

    it('calls onStart when play button clicked', () => {
      const link = makeLink({ id: 'c7', name: 'Task', column: 'backlog' });
      const onStart = vi.fn();
      render(<CardView link={link} onStart={onStart} />);
      const playBtn = screen.getByRole('button', { name: /start/i });
      fireEvent.click(playBtn);
      expect(onStart).toHaveBeenCalledOnce();
    });

    it('does not show play button for non-backlog cards', () => {
      const link = makeLink({
        id: 'c8',
        name: 'Task',
        column: 'in_progress',
      });
      render(<CardView link={link} />);
      expect(screen.queryByRole('button', { name: /start/i })).toBeNull();
    });
  });

  describe('Card selection', () => {
    it('calls onSelect when clicked', () => {
      const link = makeLink({ id: 'c9', name: 'Click me' });
      const onSelect = vi.fn();
      render(<CardView link={link} onSelect={onSelect} />);
      fireEvent.click(screen.getByText('Click me'));
      expect(onSelect).toHaveBeenCalledOnce();
    });

    it('applies selected style when isSelected', () => {
      const link = makeLink({ id: 'c10', name: 'Selected' });
      const { container } = render(<CardView link={link} isSelected />);
      const card = container.firstElementChild as HTMLElement;
      expect(card.getAttribute('data-selected')).toBe('true');
    });
  });

  describe('Badges', () => {
    it('shows tmux terminal indicator', () => {
      const link = makeLink({
        id: 'c11',
        name: 'Running',
        column: 'in_progress',
        tmuxLink: { sessionName: 'tmux-1' },
      });
      const { container } = render(<CardView link={link} />);
      const terminalIcon = container.querySelector('[data-testid="badge-tmux"]');
      expect(terminalIcon).not.toBeNull();
    });

    it('shows PR badge', () => {
      const link = makeLink({
        id: 'c12',
        name: 'With PR',
        prLinks: [{ number: 42, status: 'review_needed' }],
      });
      render(<CardView link={link} />);
      expect(screen.getByText('#42')).toBeDefined();
    });

    it('shows issue badge', () => {
      const link = makeLink({
        id: 'c13',
        name: 'With Issue',
        issueLink: { number: 7, url: 'https://example.com' },
      });
      render(<CardView link={link} />);
      expect(screen.getByText('#7')).toBeDefined();
    });

    it('shows remote indicator', () => {
      const link = makeLink({
        id: 'c14',
        name: 'Remote',
        isRemote: true,
      });
      const { container } = render(<CardView link={link} />);
      const remote = container.querySelector('[data-testid="badge-remote"]');
      expect(remote).not.toBeNull();
    });
  });

  describe('Card label badge', () => {
    it('shows SESSION label for cards with session', () => {
      const link = makeLink({
        id: 'c15',
        name: 'With Session',
        sessionLink: { sessionId: 's1' },
      });
      const { container } = render(<CardView link={link} />);
      // SESSION label shows assistant icon instead of text badge
      const assistantIcon = container.querySelector(
        '[data-testid="assistant-icon"]',
      );
      expect(assistantIcon).not.toBeNull();
    });

    it('shows ISSUE label for cards with only issue', () => {
      const link = makeLink({
        id: 'c16',
        name: 'Issue card',
        issueLink: { number: 5 },
      });
      render(<CardView link={link} />);
      expect(screen.getByText('ISSUE')).toBeDefined();
    });

    it('shows TASK label for bare cards', () => {
      const link = makeLink({ id: 'c17', name: 'Bare task' });
      render(<CardView link={link} />);
      expect(screen.getByText('TASK')).toBeDefined();
    });
  });

  describe('Relative time', () => {
    it('renders time display', () => {
      const now = new Date();
      const link = makeLink({
        id: 'c18',
        name: 'Recent',
        updatedAt: now.toISOString(),
      });
      render(<CardView link={link} />);
      // Should show "just now" for recent timestamps
      expect(screen.getByText('just now')).toBeDefined();
    });
  });

  describe('Spinner', () => {
    it('shows spinner when isLaunching', () => {
      const link = makeLink({
        id: 'c19',
        name: 'Launching',
        column: 'backlog',
        isLaunching: true,
      });
      const { container } = render(<CardView link={link} />);
      const spinner = container.querySelector('[data-testid="card-spinner"]');
      expect(spinner).not.toBeNull();
    });
  });
});
