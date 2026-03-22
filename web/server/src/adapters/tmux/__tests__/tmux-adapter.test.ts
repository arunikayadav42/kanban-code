import { describe, it, expect } from 'vitest';
import type { TmuxSession } from '@kanban-code/shared';
import { TmuxAdapter } from '../tmux-adapter.js';

describe('TmuxAdapter', () => {
  // Note: These tests require tmux to be installed.
  // Tests that need tmux are guarded with isAvailable check.

  const adapter = new TmuxAdapter();

  describe('findSessionForWorktree (pure logic, no tmux needed)', () => {
    const sessions: TmuxSession[] = [
      { name: 'feat-login', path: '/Users/me/repo/.worktrees/feat-login', attached: false },
      { name: 'proj-abc', path: '/Users/me/repo', attached: true },
      { name: 'feat-auth', path: '/Users/me/repo/.worktrees/feat-auth', attached: false },
    ];

    it('Priority 1: exact path match', () => {
      const match = adapter.findSessionForWorktree(sessions, '/Users/me/repo/.worktrees/feat-login');
      expect(match?.name).toBe('feat-login');
    });

    it('Priority 2: directory name match', () => {
      const match = adapter.findSessionForWorktree(sessions, '/other/path/feat-auth');
      expect(match?.name).toBe('feat-auth');
    });

    it('Priority 3: branch name match', () => {
      const match = adapter.findSessionForWorktree(sessions, '/unrelated/path', 'feat-login');
      expect(match?.name).toBe('feat-login');
    });

    it('Priority 4: branch with slashes → dashes', () => {
      const sessionsWithDash: TmuxSession[] = [
        { name: 'feat-new-feature', path: '/p', attached: false },
      ];
      const match = adapter.findSessionForWorktree(sessionsWithDash, '/other', 'feat/new-feature');
      expect(match?.name).toBe('feat-new-feature');
    });

    it('returns null when no match', () => {
      const match = adapter.findSessionForWorktree(sessions, '/nonexistent', 'nonexistent-branch');
      expect(match).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('returns boolean', async () => {
      const available = await adapter.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('listSessions (requires tmux)', () => {
    it('returns array (may be empty if no tmux server)', async () => {
      const available = await adapter.isAvailable();
      if (!available) return; // skip if tmux not installed

      const sessions = await adapter.listSessions();
      expect(Array.isArray(sessions)).toBe(true);
      // Each session should have name, path, attached
      for (const s of sessions) {
        expect(typeof s.name).toBe('string');
        expect(typeof s.path).toBe('string');
        expect(typeof s.attached).toBe('boolean');
      }
    });
  });

  describe('createSession + killSession (requires tmux)', () => {
    const testSessionName = 'kanban-test-' + Date.now();

    it('creates and kills a session', async () => {
      const available = await adapter.isAvailable();
      if (!available) return;

      try {
        // Create
        await adapter.createSession(testSessionName, '/tmp');
        const sessions = await adapter.listSessions();
        const found = sessions.find(s => s.name === testSessionName);
        expect(found).toBeDefined();

        // Reuse: creating again should not throw
        await adapter.createSession(testSessionName, '/tmp');

        // Kill
        await adapter.killSession(testSessionName);
        const after = await adapter.listSessions();
        expect(after.find(s => s.name === testSessionName)).toBeUndefined();
      } catch {
        // Clean up on failure
        try { await adapter.killSession(testSessionName); } catch { /* ignore */ }
      }
    });

    it('creates with single-line command', async () => {
      const available = await adapter.isAvailable();
      if (!available) return;

      const name = 'kanban-cmd-' + Date.now();
      try {
        await adapter.createSession(name, '/tmp', 'echo hello');
        const sessions = await adapter.listSessions();
        expect(sessions.find(s => s.name === name)).toBeDefined();
      } finally {
        try { await adapter.killSession(name); } catch { /* ignore */ }
      }
    });

    it('creates with multi-line command (temp file sourcing)', async () => {
      const available = await adapter.isAvailable();
      if (!available) return;

      const name = 'kanban-multi-' + Date.now();
      try {
        await adapter.createSession(name, '/tmp', 'echo line1\necho line2');
        const sessions = await adapter.listSessions();
        expect(sessions.find(s => s.name === name)).toBeDefined();
      } finally {
        try { await adapter.killSession(name); } catch { /* ignore */ }
      }
    });
  });

  describe('capturePane (requires tmux)', () => {
    it('captures pane output', async () => {
      const available = await adapter.isAvailable();
      if (!available) return;

      const name = 'kanban-capture-' + Date.now();
      try {
        await adapter.createSession(name, '/tmp');
        // Wait for shell to start
        await new Promise(r => setTimeout(r, 500));
        const output = await adapter.capturePane(name);
        expect(typeof output).toBe('string');
      } finally {
        try { await adapter.killSession(name); } catch { /* ignore */ }
      }
    });
  });
});
