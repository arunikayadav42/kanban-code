import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ProcessManagerView from '../ProcessManagerView';
import type { TmuxSession, Worktree } from '@kanban-code/shared';

const mockTmuxSessions: TmuxSession[] = [
  { name: 'card_abc123', path: '/Users/dev/my-app', attached: true },
  { name: 'my-session', path: '/Users/dev/api', attached: false },
  { name: 'card_def456', path: '/Users/dev/other', attached: false },
];

const mockWorktrees: Worktree[] = [
  { path: '/Users/dev/my-app/.worktrees/feat-auth', branch: 'feat/auth', isBare: false },
  { path: '/Users/dev/my-app/.worktrees/fix-bug', branch: 'fix/bug-123', isBare: false },
  { path: '/Users/dev/my-app/.worktrees/detached', branch: null, isBare: false },
];

describe('ProcessManagerView', () => {
  let fetchTmux: ReturnType<typeof vi.fn>;
  let fetchWorktrees: ReturnType<typeof vi.fn>;
  let onKillTmux: ReturnType<typeof vi.fn>;
  let onRemoveWorktree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchTmux = vi.fn().mockResolvedValue(mockTmuxSessions);
    fetchWorktrees = vi.fn().mockResolvedValue(mockWorktrees);
    onKillTmux = vi.fn().mockResolvedValue(undefined);
    onRemoveWorktree = vi.fn().mockResolvedValue(undefined);
  });

  function renderPM(overrides: Record<string, unknown> = {}) {
    return render(
      <ProcessManagerView
        fetchTmuxSessions={fetchTmux}
        fetchWorktrees={fetchWorktrees}
        onKillTmuxSession={onKillTmux}
        onRemoveWorktree={onRemoveWorktree}
        {...overrides}
      />,
    );
  }

  describe('Rendering', () => {
    it('renders the process manager container', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('process-manager')).toBeDefined();
      });
    });

    it('loads data on mount', async () => {
      renderPM();
      await waitFor(() => {
        expect(fetchTmux).toHaveBeenCalled();
        expect(fetchWorktrees).toHaveBeenCalled();
      });
    });
  });

  describe('Tab navigation', () => {
    it('renders all 3 tabs', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-tmux')).toBeDefined();
      });
      expect(screen.getByTestId('tab-processes')).toBeDefined();
      expect(screen.getByTestId('tab-worktrees')).toBeDefined();
    });

    it('defaults to Tmux tab', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tmux-list')).toBeDefined();
      });
    });

    it('shows tab labels with counts', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-tmux').textContent).toBe('Tmux (3)');
      });
      expect(screen.getByTestId('tab-worktrees').textContent).toBe('Worktrees (3)');
    });

    it('switches to Processes tab', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-processes')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-processes'));
      expect(screen.getByTestId('processes-info')).toBeDefined();
    });

    it('switches to Worktrees tab', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-worktrees')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-worktrees'));
      expect(screen.getByTestId('worktrees-list')).toBeDefined();
    });
  });

  describe('Tmux tab', () => {
    it('lists all tmux sessions', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tmux-row-card_abc123')).toBeDefined();
      });
      expect(screen.getByTestId('tmux-row-my-session')).toBeDefined();
      expect(screen.getByTestId('tmux-row-card_def456')).toBeDefined();
    });

    it('shows attached status indicator (green for attached)', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tmux-status-card_abc123')).toBeDefined();
      });
      const indicator = screen.getByTestId('tmux-status-card_abc123');
      // jsdom converts hex #22c55e to rgb(34, 197, 94)
      const bg = indicator.style.backgroundColor;
      expect(bg === '#22c55e' || bg === 'rgb(34, 197, 94)').toBe(true);
    });

    it('shows detached status indicator (gray)', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tmux-status-my-session')).toBeDefined();
      });
      const indicator = screen.getByTestId('tmux-status-my-session');
      // jsdom converts hex #6b7280 to rgb(107, 114, 128)
      const bg = indicator.style.backgroundColor;
      expect(bg === '#6b7280' || bg === 'rgb(107, 114, 128)').toBe(true);
    });

    it('shows "managed" badge for card sessions', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tmux-row-card_abc123')).toBeDefined();
      });
      expect(screen.getAllByText('managed').length).toBeGreaterThanOrEqual(1);
    });

    it('shows kill button for each session', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('kill-tmux-card_abc123')).toBeDefined();
      });
      expect(screen.getByTestId('kill-tmux-my-session')).toBeDefined();
    });

    it('kills a session and removes it from list', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('kill-tmux-my-session')).toBeDefined();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('kill-tmux-my-session'));
      });

      expect(onKillTmux).toHaveBeenCalledWith('my-session');
      expect(screen.queryByTestId('tmux-row-my-session')).toBeNull();
    });

    it('shows empty state when no sessions', async () => {
      fetchTmux.mockResolvedValue([]);
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tmux-empty')).toBeDefined();
      });
      expect(screen.getByText('No tmux sessions found')).toBeDefined();
    });

    it('abbreviates paths with ~ for home directory', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tmux-row-card_abc123')).toBeDefined();
      });
      // /Users/dev/my-app should be abbreviated
      expect(screen.getByText('~/my-app')).toBeDefined();
    });
  });

  describe('Processes tab', () => {
    it('shows informational message', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-processes')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-processes'));
      expect(screen.getByText('Claude / Gemini Processes')).toBeDefined();
      expect(screen.getByText(/managed through tmux sessions/)).toBeDefined();
    });
  });

  describe('Worktrees tab', () => {
    it('lists all worktrees', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-worktrees')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-worktrees'));
      expect(screen.getByText('feat/auth')).toBeDefined();
      expect(screen.getByText('fix/bug-123')).toBeDefined();
    });

    it('shows detached label for worktrees without branch', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-worktrees')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-worktrees'));
      expect(screen.getByText('(detached)')).toBeDefined();
    });

    it('shows Remove button for each worktree', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-worktrees')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-worktrees'));
      const removeButtons = screen.getAllByText('Remove');
      expect(removeButtons.length).toBe(3);
    });

    it('removes a worktree and updates list', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-worktrees')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-worktrees'));

      const path = '/Users/dev/my-app/.worktrees/feat-auth';
      await act(async () => {
        fireEvent.click(screen.getByTestId(`remove-worktree-${path}`));
      });

      expect(onRemoveWorktree).toHaveBeenCalledWith(path, false);
      expect(screen.queryByTestId(`worktree-row-${path}`)).toBeNull();
    });

    it('shows empty state when no worktrees', async () => {
      fetchWorktrees.mockResolvedValue([]);
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('tab-worktrees')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('tab-worktrees'));
      expect(screen.getByTestId('worktrees-empty')).toBeDefined();
      expect(screen.getByText('No worktrees found')).toBeDefined();
    });
  });

  describe('Bottom bar', () => {
    it('shows Refresh button', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('btn-refresh')).toBeDefined();
      });
    });

    it('refreshes data on click', async () => {
      renderPM();
      await waitFor(() => {
        expect(fetchTmux).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-refresh'));
      });

      expect(fetchTmux).toHaveBeenCalledTimes(2);
      expect(fetchWorktrees).toHaveBeenCalledTimes(2);
    });

    it('shows Done button when onClose provided', async () => {
      const onClose = vi.fn();
      renderPM({ onClose });
      await waitFor(() => {
        expect(screen.getByTestId('btn-close')).toBeDefined();
      });
    });

    it('calls onClose when Done clicked', async () => {
      const onClose = vi.fn();
      renderPM({ onClose });
      await waitFor(() => {
        expect(screen.getByTestId('btn-close')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('btn-close'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not show Done button without onClose', async () => {
      renderPM();
      await waitFor(() => {
        expect(screen.getByTestId('btn-refresh')).toBeDefined();
      });
      expect(screen.queryByTestId('btn-close')).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('handles fetch failures gracefully', async () => {
      fetchTmux.mockRejectedValue(new Error('Network error'));
      fetchWorktrees.mockRejectedValue(new Error('Network error'));
      renderPM();
      await waitFor(() => {
        // Should show empty state, not crash
        expect(screen.getByTestId('tmux-empty')).toBeDefined();
      });
    });
  });
});
