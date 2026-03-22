import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CardDetailView, { getInitialTab } from '../CardDetailView';
import type { Link } from '@kanban-code/shared';
import { createLink } from '@kanban-code/shared';

// Mock Terminal components (xterm requires DOM APIs not in jsdom)
vi.mock('../Terminal.js', () => ({
  default: ({ sessionName }: { sessionName: string }) => (
    <div data-testid={`mock-terminal-${sessionName}`}>Terminal: {sessionName}</div>
  ),
}));

vi.mock('../TerminalTabs.js', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="mock-terminal-tabs">
      TerminalTabs: {JSON.stringify({ allSessions: props.allSessions })}
    </div>
  ),
}));

function makeLink(overrides: Partial<Link> & { id: string }): Link {
  return createLink({
    column: 'backlog',
    source: 'manual',
    projectPath: '/test/project',
    ...overrides,
  });
}

describe('CardDetailView', () => {
  describe('getInitialTab', () => {
    it('returns terminal when tmuxLink present', () => {
      const link = makeLink({ id: 'c1', tmuxLink: { sessionName: 'tmux-1' } });
      expect(getInitialTab(link)).toBe('terminal');
    });

    it('returns history when sessionLink present (no tmux)', () => {
      const link = makeLink({ id: 'c2', sessionLink: { sessionId: 's1' } });
      expect(getInitialTab(link)).toBe('history');
    });

    it('returns issue when issueLink present (no session/tmux)', () => {
      const link = makeLink({ id: 'c3', issueLink: { number: 42 } });
      expect(getInitialTab(link)).toBe('issue');
    });

    it('returns pullRequest when prLinks present', () => {
      const link = makeLink({ id: 'c4', prLinks: [{ number: 10 }] });
      expect(getInitialTab(link)).toBe('pullRequest');
    });

    it('returns prompt when promptBody present (no other links)', () => {
      const link = makeLink({ id: 'c5', promptBody: 'Fix the thing' });
      expect(getInitialTab(link)).toBe('prompt');
    });

    it('defaults to history when no links', () => {
      const link = makeLink({ id: 'c6' });
      expect(getInitialTab(link)).toBe('history');
    });
  });

  describe('Rendering', () => {
    it('renders the detail view container', () => {
      const link = makeLink({ id: 'c1', name: 'Test Card' });
      render(<CardDetailView link={link} />);
      expect(screen.getByTestId('card-detail-view')).toBeDefined();
    });

    it('shows card title in header', () => {
      const link = makeLink({ id: 'c1', name: 'Fix Login Bug' });
      render(<CardDetailView link={link} />);
      expect(screen.getByTestId('detail-title').textContent).toBe('Fix Login Bug');
    });

    it('shows session ID when sessionLink exists', () => {
      const link = makeLink({
        id: 'c2',
        name: 'Session Card',
        sessionLink: { sessionId: 'sess-abc-123' },
      });
      render(<CardDetailView link={link} />);
      expect(screen.getByText('sess-abc-123')).toBeDefined();
    });

    it('shows project name from path', () => {
      const link = makeLink({
        id: 'c3',
        name: 'Project Card',
        projectPath: '/Users/dev/my-app',
      });
      render(<CardDetailView link={link} />);
      expect(screen.getByText('my-app')).toBeDefined();
    });

    it('shows branch label', () => {
      const link = makeLink({
        id: 'c4',
        name: 'Branch Card',
        worktreeLink: { path: '/wt', branch: 'feat/auth' },
      });
      render(<CardDetailView link={link} />);
      expect(screen.getByText(/feat\/auth/)).toBeDefined();
    });

    it('shows Remote badge when isRemote', () => {
      const link = makeLink({ id: 'c5', name: 'Remote Card', isRemote: true });
      render(<CardDetailView link={link} />);
      expect(screen.getByText('Remote')).toBeDefined();
    });
  });

  describe('Tab bar', () => {
    it('renders only History tab when no tmuxLink', () => {
      const link = makeLink({ id: 'c1', name: 'Card' });
      render(<CardDetailView link={link} />);
      expect(screen.queryByTestId('tab-terminal')).toBeNull();
      expect(screen.getByTestId('tab-history')).toBeDefined();
    });

    it('renders Terminal and History tabs when tmuxLink present', () => {
      const link = makeLink({ id: 'c1', name: 'Card', tmuxLink: { sessionName: 'proj-abc' } });
      render(<CardDetailView link={link} />);
      expect(screen.getByTestId('tab-terminal')).toBeDefined();
      expect(screen.getByTestId('tab-history')).toBeDefined();
    });

    it('renders Issue tab when issueLink present', () => {
      const link = makeLink({
        id: 'c2',
        name: 'Card',
        issueLink: { number: 5, body: 'Issue body' },
      });
      render(<CardDetailView link={link} />);
      expect(screen.getByTestId('tab-issue')).toBeDefined();
    });

    it('renders Pull Request tab when prLinks present', () => {
      const link = makeLink({
        id: 'c3',
        name: 'Card',
        prLinks: [{ number: 42 }],
      });
      render(<CardDetailView link={link} />);
      expect(screen.getByTestId('tab-pullRequest')).toBeDefined();
    });

    it('renders Prompt tab when promptBody present (no issue)', () => {
      const link = makeLink({
        id: 'c4',
        name: 'Card',
        promptBody: 'Do something',
      });
      render(<CardDetailView link={link} />);
      expect(screen.getByTestId('tab-prompt')).toBeDefined();
    });

    it('does NOT render Prompt tab when issueLink present', () => {
      const link = makeLink({
        id: 'c5',
        name: 'Card',
        promptBody: 'Do something',
        issueLink: { number: 3 },
      });
      render(<CardDetailView link={link} />);
      expect(screen.queryByTestId('tab-prompt')).toBeNull();
    });

    it('switches tabs on click', () => {
      const link = makeLink({ id: 'c6', name: 'Card' });
      render(<CardDetailView link={link} />);
      fireEvent.click(screen.getByTestId('tab-history'));
      // History tab should be visually selected (active)
      const historyTab = screen.getByTestId('tab-history');
      expect(historyTab.style.fontWeight).toBe('600');
    });
  });

  describe('History tab content', () => {
    it('shows empty state when no turns', () => {
      const link = makeLink({ id: 'c1', name: 'Card', sessionLink: { sessionId: 's1' } });
      render(<CardDetailView link={link} turns={[]} selectedTab="history" />);
      expect(screen.getByTestId('history-empty')).toBeDefined();
    });

    it('shows loading state', () => {
      const link = makeLink({ id: 'c1', name: 'Card', sessionLink: { sessionId: 's1' } });
      render(<CardDetailView link={link} turns={[]} isLoadingHistory selectedTab="history" />);
      expect(screen.getByTestId('history-loading')).toBeDefined();
    });

    it('renders conversation turns', () => {
      const link = makeLink({ id: 'c1', name: 'Card', sessionLink: { sessionId: 's1' } });
      const turns = [
        { index: 0, lineNumber: 1, role: 'user', textPreview: 'Fix the bug', contentBlocks: [] },
        { index: 1, lineNumber: 2, role: 'assistant', textPreview: 'Done!', contentBlocks: [] },
      ];
      render(<CardDetailView link={link} turns={turns} selectedTab="history" />);
      expect(screen.getByText('Fix the bug')).toBeDefined();
      expect(screen.getByText('Done!')).toBeDefined();
    });
  });

  describe('Issue tab content', () => {
    it('renders issue title and number', () => {
      const link = makeLink({
        id: 'c1',
        name: 'Card',
        issueLink: { number: 42, title: 'Login fails', body: 'Steps to repro' },
      });
      render(<CardDetailView link={link} selectedTab="issue" />);
      expect(screen.getByText('Login fails')).toBeDefined();
      expect(screen.getByText('#42')).toBeDefined();
    });

    it('renders issue body', () => {
      const link = makeLink({
        id: 'c2',
        name: 'Card',
        issueLink: { number: 1, body: 'Detailed description here' },
      });
      render(<CardDetailView link={link} selectedTab="issue" />);
      expect(screen.getByTestId('issue-body')).toBeDefined();
      expect(screen.getByText('Detailed description here')).toBeDefined();
    });
  });

  describe('PR tab content', () => {
    it('renders PR title', () => {
      const link = makeLink({
        id: 'c1',
        name: 'Card',
        prLinks: [{ number: 99, title: 'Add feature X' }],
      });
      render(<CardDetailView link={link} selectedTab="pullRequest" />);
      expect(screen.getByText('Add feature X')).toBeDefined();
    });

    it('renders multiple PRs', () => {
      const link = makeLink({
        id: 'c2',
        name: 'Card',
        prLinks: [
          { number: 10, title: 'PR One' },
          { number: 20, title: 'PR Two' },
        ],
      });
      render(<CardDetailView link={link} selectedTab="pullRequest" />);
      expect(screen.getByText('PR One')).toBeDefined();
      expect(screen.getByText('PR Two')).toBeDefined();
    });
  });

  describe('Prompt tab content', () => {
    it('renders prompt body', () => {
      const link = makeLink({
        id: 'c1',
        name: 'Card',
        promptBody: 'Refactor the auth module',
      });
      render(<CardDetailView link={link} selectedTab="prompt" />);
      expect(screen.getByTestId('prompt-body')).toBeDefined();
      expect(screen.getByText('Refactor the auth module')).toBeDefined();
    });

    it('has a copy button', () => {
      const link = makeLink({
        id: 'c2',
        name: 'Card',
        promptBody: 'Some prompt',
      });
      render(<CardDetailView link={link} selectedTab="prompt" />);
      expect(screen.getByTestId('copy-prompt')).toBeDefined();
    });
  });

  describe('Actions', () => {
    it('shows Start button for backlog cards without tmux', () => {
      const link = makeLink({ id: 'c1', name: 'Card', column: 'backlog' });
      const onResume = vi.fn();
      render(<CardDetailView link={link} onResume={onResume} />);
      const btn = screen.getByTestId('action-resume');
      expect(btn.textContent).toContain('Start');
    });

    it('shows Resume button for cards with session but no tmux', () => {
      const link = makeLink({
        id: 'c2',
        name: 'Card',
        column: 'requires_attention',
        sessionLink: { sessionId: 's1' },
      });
      const onResume = vi.fn();
      render(<CardDetailView link={link} onResume={onResume} />);
      const btn = screen.getByTestId('action-resume');
      expect(btn.textContent).toContain('Resume');
    });

    it('does not show Start/Resume when tmux is active', () => {
      const link = makeLink({
        id: 'c3',
        name: 'Card',
        column: 'in_progress',
        tmuxLink: { sessionName: 'tmux-1' },
      });
      render(<CardDetailView link={link} />);
      expect(screen.queryByTestId('action-resume')).toBeNull();
    });

    it('calls onResume when Start/Resume clicked', () => {
      const link = makeLink({ id: 'c4', name: 'Card', column: 'backlog' });
      const onResume = vi.fn();
      render(<CardDetailView link={link} onResume={onResume} />);
      fireEvent.click(screen.getByTestId('action-resume'));
      expect(onResume).toHaveBeenCalledOnce();
    });

    it('shows close button and calls onClose', () => {
      const link = makeLink({ id: 'c5', name: 'Card' });
      const onClose = vi.fn();
      render(<CardDetailView link={link} onClose={onClose} />);
      const btn = screen.getByTestId('action-close');
      fireEvent.click(btn);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('toggles actions menu', () => {
      const link = makeLink({ id: 'c6', name: 'Card' });
      render(<CardDetailView link={link} onArchive={() => {}} onDelete={() => {}} />);
      fireEvent.click(screen.getByTestId('actions-menu-trigger'));
      expect(screen.getByTestId('actions-menu')).toBeDefined();
    });
  });

  describe('Terminal tab', () => {
    it('shows empty state when no tmux/session/launching', () => {
      const link = makeLink({ id: 'c1', name: 'Card' });
      render(<CardDetailView link={link} selectedTab="terminal" />);
      expect(screen.getByTestId('terminal-empty')).toBeDefined();
    });

    it('shows New Terminal button in empty state', () => {
      const link = makeLink({ id: 'c2', name: 'Card' });
      const onCreateTerminal = vi.fn();
      render(<CardDetailView link={link} selectedTab="terminal" onCreateTerminal={onCreateTerminal} />);
      const btn = screen.getByText('New Terminal');
      fireEvent.click(btn);
      expect(onCreateTerminal).toHaveBeenCalledOnce();
    });

    it('renders TerminalTabs when tmux exists', () => {
      const link = makeLink({
        id: 'c3',
        name: 'Card',
        tmuxLink: { sessionName: 'tmux-main' },
      });
      render(<CardDetailView link={link} selectedTab="terminal" />);
      expect(screen.getByTestId('mock-terminal-tabs')).toBeDefined();
    });
  });

  describe('Expand/Collapse', () => {
    it('calls onToggleExpand when expand button clicked', () => {
      const link = makeLink({ id: 'c1', name: 'Card' });
      const onToggle = vi.fn();
      render(<CardDetailView link={link} onToggleExpand={onToggle} />);
      fireEvent.click(screen.getByTestId('action-expand'));
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('hides header when expanded', () => {
      const link = makeLink({ id: 'c2', name: 'Card' });
      render(<CardDetailView link={link} isExpanded />);
      expect(screen.queryByTestId('detail-title')).toBeNull();
    });
  });

  describe('Fork confirmation', () => {
    it('shows fork dialog from actions menu', () => {
      const link = makeLink({
        id: 'c1',
        name: 'Card',
        sessionLink: { sessionId: 's1', sessionPath: '/path' },
      });
      const onFork = vi.fn();
      render(<CardDetailView link={link} onFork={onFork} />);
      fireEvent.click(screen.getByTestId('actions-menu-trigger'));
      const forkBtn = screen.getByText('Fork Session');
      fireEvent.click(forkBtn);
      expect(screen.getByTestId('confirm-dialog')).toBeDefined();
    });
  });
});
