import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TerminalTabs from '../TerminalTabs';
import type { Link } from '@kanban-code/shared';
import { createLink } from '@kanban-code/shared';

// Mock TerminalView (xterm needs real DOM)
vi.mock('../Terminal.js', () => ({
  default: ({ sessionName }: { sessionName: string }) => (
    <div data-testid={`mock-terminal-${sessionName}`}>Terminal: {sessionName}</div>
  ),
}));

function makeLink(overrides: Partial<Link> & { id: string }): Link {
  return createLink({
    column: 'in_progress',
    source: 'manual',
    projectPath: '/test/project',
    ...overrides,
  });
}

describe('TerminalTabs', () => {
  const baseLinkFields = {
    id: 'card-1',
    name: 'Test Card',
    tmuxLink: { sessionName: 'claude-main' },
  };

  const baseProps = {
    link: makeLink(baseLinkFields),
    claudeSession: 'claude-main',
    shellSessions: [] as string[],
    allSessions: ['claude-main'],
    fontSize: 12,
    isLaunching: false,
    assistant: 'claude' as const,
    queuedPrompts: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the terminal tabs container', () => {
      render(<TerminalTabs {...baseProps} />);
      expect(screen.getByTestId('terminal-tabs')).toBeDefined();
    });

    it('renders the tab bar', () => {
      render(<TerminalTabs {...baseProps} />);
      expect(screen.getByTestId('terminal-tab-bar')).toBeDefined();
    });

    it('renders the Claude tab', () => {
      render(<TerminalTabs {...baseProps} />);
      expect(screen.getByTestId('tab-claude')).toBeDefined();
    });

    it('renders the add terminal button', () => {
      render(<TerminalTabs {...baseProps} />);
      expect(screen.getByTestId('add-terminal')).toBeDefined();
    });
  });

  describe('Claude tab', () => {
    it('shows Claude Code label', () => {
      render(<TerminalTabs {...baseProps} />);
      expect(screen.getByText('Claude Code')).toBeDefined();
    });

    it('shows Gemini CLI label for gemini assistant', () => {
      render(<TerminalTabs {...baseProps} assistant="gemini" />);
      expect(screen.getByText('Gemini CLI')).toBeDefined();
    });

    it('renders terminal for active claude session', () => {
      render(<TerminalTabs {...baseProps} />);
      expect(screen.getByTestId('mock-terminal-claude-main')).toBeDefined();
    });

    it('shows close button when claude session is live', () => {
      const onKill = vi.fn();
      render(<TerminalTabs {...baseProps} onKillTerminal={onKill} />);
      // Claude tab should have a close (x) button
      const claudeTab = screen.getByTestId('tab-claude');
      const closeBtn = claudeTab.querySelector('button:last-child');
      expect(closeBtn).not.toBeNull();
    });
  });

  describe('Shell tabs', () => {
    it('renders shell tabs when present', () => {
      render(
        <TerminalTabs
          {...baseProps}
          shellSessions={['shell-1', 'shell-2']}
          allSessions={['claude-main', 'shell-1', 'shell-2']}
        />,
      );
      expect(screen.getByTestId('tab-shell-0')).toBeDefined();
      expect(screen.getByTestId('tab-shell-1')).toBeDefined();
    });

    it('uses custom tab names when provided', () => {
      const link = makeLink({
        ...baseLinkFields,
        tmuxLink: {
          sessionName: 'claude-main',
          extraSessions: ['shell-1'],
          tabNames: { 'shell-1': 'Build' },
        },
      });
      render(
        <TerminalTabs
          {...baseProps}
          link={link}
          shellSessions={['shell-1']}
          allSessions={['claude-main', 'shell-1']}
        />,
      );
      expect(screen.getByText('Build')).toBeDefined();
    });

    it('switches to shell tab on click', () => {
      render(
        <TerminalTabs
          {...baseProps}
          shellSessions={['shell-1']}
          allSessions={['claude-main', 'shell-1']}
        />,
      );
      fireEvent.click(screen.getByText('shell 1'));
      // Shell terminal should now be visible
      const shellTerminal = screen.getByTestId('mock-terminal-shell-1');
      expect(shellTerminal.parentElement?.style.display).toBe('block');
    });

    it('calls onKillTerminal when shell close button clicked', () => {
      const onKill = vi.fn();
      render(
        <TerminalTabs
          {...baseProps}
          shellSessions={['shell-1']}
          allSessions={['claude-main', 'shell-1']}
          onKillTerminal={onKill}
        />,
      );
      const shellTab = screen.getByTestId('tab-shell-0');
      const closeBtn = shellTab.querySelector('button:last-child');
      if (closeBtn) fireEvent.click(closeBtn);
      expect(onKill).toHaveBeenCalledWith('shell-1');
    });
  });

  describe('Add terminal button', () => {
    it('calls onCreateTerminal when + clicked', () => {
      const onCreate = vi.fn();
      render(<TerminalTabs {...baseProps} onCreateTerminal={onCreate} />);
      fireEvent.click(screen.getByTestId('add-terminal'));
      expect(onCreate).toHaveBeenCalledOnce();
    });
  });

  describe('Copy tmux attach', () => {
    it('shows copy button when there is an active session', () => {
      render(<TerminalTabs {...baseProps} />);
      expect(screen.getByTestId('copy-tmux-attach')).toBeDefined();
    });

    it('does not show copy button when no active session', () => {
      render(
        <TerminalTabs
          {...baseProps}
          claudeSession={null}
          allSessions={[]}
        />,
      );
      expect(screen.queryByTestId('copy-tmux-attach')).toBeNull();
    });
  });

  describe('Overlay states', () => {
    it('shows launching overlay when isLaunching and no claude session', () => {
      render(
        <TerminalTabs
          {...baseProps}
          claudeSession={null}
          allSessions={[]}
          isLaunching
        />,
      );
      expect(screen.getByTestId('terminal-overlay')).toBeDefined();
      expect(screen.getByTestId('launch-spinner')).toBeDefined();
      expect(screen.getByText('Starting session...')).toBeDefined();
    });

    it('shows cancel button during launch', () => {
      const onCancel = vi.fn();
      render(
        <TerminalTabs
          {...baseProps}
          claudeSession={null}
          allSessions={[]}
          isLaunching
          onCancelLaunch={onCancel}
        />,
      );
      const cancelBtn = screen.getByTestId('cancel-launch');
      fireEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('shows session ended overlay when session exists but no tmux', () => {
      const link = makeLink({
        id: 'card-1',
        name: 'Card',
        sessionLink: { sessionId: 's1' },
        tmuxLink: { sessionName: 'tmux-1', isPrimaryDead: true },
      });
      render(
        <TerminalTabs
          {...baseProps}
          link={link}
          claudeSession={null}
          allSessions={[]}
        />,
      );
      expect(screen.getByText(/session ended/)).toBeDefined();
    });

    it('shows resume button in session ended overlay', () => {
      const onResume = vi.fn();
      const link = makeLink({
        id: 'card-1',
        name: 'Card',
        sessionLink: { sessionId: 's1' },
        tmuxLink: { sessionName: 'tmux-1', isPrimaryDead: true },
      });
      render(
        <TerminalTabs
          {...baseProps}
          link={link}
          claudeSession={null}
          allSessions={[]}
          onResume={onResume}
        />,
      );
      const resumeBtn = screen.getByTestId('resume-session');
      fireEvent.click(resumeBtn);
      expect(onResume).toHaveBeenCalledOnce();
    });

    it('shows "No agent session" when no session and not launching', () => {
      const link = makeLink({ id: 'card-1', name: 'Card' });
      render(
        <TerminalTabs
          {...baseProps}
          link={link}
          claudeSession={null}
          allSessions={[]}
        />,
      );
      expect(screen.getByText('No agent session')).toBeDefined();
    });
  });

  describe('Queued prompts', () => {
    it('shows queued prompts bar when prompts exist', () => {
      render(
        <TerminalTabs
          {...baseProps}
          queuedPrompts={[
            { id: 'p1', body: 'Fix the tests', sendAutomatically: false },
            { id: 'p2', body: 'Add documentation', sendAutomatically: true },
          ]}
        />,
      );
      expect(screen.getByTestId('queued-prompts')).toBeDefined();
      expect(screen.getByText(/Fix the tests/)).toBeDefined();
    });

    it('hides queued prompts bar when empty', () => {
      render(<TerminalTabs {...baseProps} queuedPrompts={[]} />);
      expect(screen.queryByTestId('queued-prompts')).toBeNull();
    });

    it('calls onSendQueuedPrompt when Send clicked', () => {
      const onSend = vi.fn();
      render(
        <TerminalTabs
          {...baseProps}
          queuedPrompts={[{ id: 'p1', body: 'Do it', sendAutomatically: false }]}
          onSendQueuedPrompt={onSend}
        />,
      );
      const sendBtns = screen.getAllByText('Send');
      fireEvent.click(sendBtns[0]);
      expect(onSend).toHaveBeenCalledWith('p1');
    });

    it('calls onRemoveQueuedPrompt when x clicked', () => {
      const onRemove = vi.fn();
      render(
        <TerminalTabs
          {...baseProps}
          queuedPrompts={[{ id: 'p1', body: 'Remove me', sendAutomatically: false }]}
          onRemoveQueuedPrompt={onRemove}
        />,
      );
      const removeBtns = screen.getAllByText('x');
      // Filter to find the one inside queued-prompts (not tab close buttons)
      const queuedSection = screen.getByTestId('queued-prompts');
      const removeBtn = queuedSection.querySelector('button:last-child');
      if (removeBtn) fireEvent.click(removeBtn);
      expect(onRemove).toHaveBeenCalledWith('p1');
    });
  });

  describe('Multiple terminals rendered', () => {
    it('renders all session terminals', () => {
      render(
        <TerminalTabs
          {...baseProps}
          shellSessions={['shell-a', 'shell-b']}
          allSessions={['claude-main', 'shell-a', 'shell-b']}
        />,
      );
      expect(screen.getByTestId('mock-terminal-claude-main')).toBeDefined();
      expect(screen.getByTestId('mock-terminal-shell-a')).toBeDefined();
      expect(screen.getByTestId('mock-terminal-shell-b')).toBeDefined();
    });

    it('only shows active session terminal (others hidden)', () => {
      render(
        <TerminalTabs
          {...baseProps}
          shellSessions={['shell-a']}
          allSessions={['claude-main', 'shell-a']}
        />,
      );
      // Claude is selected by default
      const claudeParent = screen.getByTestId('mock-terminal-claude-main').parentElement;
      const shellParent = screen.getByTestId('mock-terminal-shell-a').parentElement;
      expect(claudeParent?.style.display).toBe('block');
      expect(shellParent?.style.display).toBe('none');
    });
  });
});
