import { describe, it, expect, vi } from 'vitest';
import { GitWorktreeAdapter, parseWorktreeList, WorktreeError } from '../worktree-adapter.js';
import type { Worktree } from '@kanban-code/shared';

describe('GitWorktreeAdapter', () => {
  describe('parseWorktreeList', () => {
    it('parses porcelain output with multiple worktrees', () => {
      const output = [
        'worktree /Users/test/Projects/myapp',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /Users/test/Projects/myapp/.worktrees/feature-x',
        'HEAD def456',
        'branch refs/heads/feature-x',
        '',
        'worktree /Users/test/Projects/myapp/.worktrees/fix-bug',
        'HEAD 789abc',
        'branch refs/heads/fix/bug-123',
        '',
      ].join('\n');

      const worktrees = parseWorktreeList(output);
      expect(worktrees).toHaveLength(3);

      expect(worktrees[0].path).toBe('/Users/test/Projects/myapp');
      expect(worktrees[0].branch).toBe('main');
      expect(worktrees[0].isBare).toBe(false);

      expect(worktrees[1].path).toBe('/Users/test/Projects/myapp/.worktrees/feature-x');
      expect(worktrees[1].branch).toBe('feature-x');

      expect(worktrees[2].path).toBe('/Users/test/Projects/myapp/.worktrees/fix-bug');
      expect(worktrees[2].branch).toBe('fix/bug-123');
    });

    it('parses bare worktree', () => {
      const output = [
        'worktree /Users/test/Projects/myapp.git',
        'bare',
        '',
      ].join('\n');

      const worktrees = parseWorktreeList(output);
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].isBare).toBe(true);
      expect(worktrees[0].branch).toBeNull();
    });

    it('returns empty for empty output', () => {
      expect(parseWorktreeList('')).toHaveLength(0);
    });

    it('parses single worktree (main only)', () => {
      const output = [
        'worktree /Users/test/project',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
      ].join('\n');

      const worktrees = parseWorktreeList(output);
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].branch).toBe('main');
    });
  });

  describe('listWorktrees', () => {
    it('calls git worktree list --porcelain and parses output', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n',
        stderr: '',
        exitCode: 0,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      const result = await adapter.listWorktrees('/repo');

      expect(mockRun).toHaveBeenCalledWith(
        '/usr/bin/git',
        ['worktree', 'list', '--porcelain'],
        { cwd: '/repo' },
      );
      expect(result).toHaveLength(1);
      expect(result[0].branch).toBe('main');
    });

    it('returns empty when git command fails', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: false,
        stdout: '',
        stderr: 'not a git repo',
        exitCode: 128,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      const result = await adapter.listWorktrees('/not-a-repo');
      expect(result).toHaveLength(0);
    });
  });

  describe('createWorktree', () => {
    it('creates worktree at .worktrees/<name> path', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      const wt = await adapter.createWorktree('/repo', 'feature-x');

      expect(mockRun).toHaveBeenCalledWith(
        '/usr/bin/git',
        ['worktree', 'add', '-b', 'feature-x', '/repo/.worktrees/feature-x'],
        { cwd: '/repo' },
      );
      expect(wt.path).toBe('/repo/.worktrees/feature-x');
      expect(wt.branch).toBe('feature-x');
    });

    it('throws WorktreeError on failure', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: false,
        stdout: '',
        stderr: 'branch already exists',
        exitCode: 128,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      await expect(adapter.createWorktree('/repo', 'existing')).rejects.toThrow(WorktreeError);
    });
  });

  describe('removeWorktree', () => {
    it('calls git worktree remove with path', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      await adapter.removeWorktree('/repo/.claude/worktrees/feature-x', false);

      expect(mockRun).toHaveBeenCalledWith(
        '/usr/bin/git',
        ['worktree', 'remove', '/repo/.claude/worktrees/feature-x'],
        { cwd: '/repo' },
      );
    });

    it('adds --force flag when force is true', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      await adapter.removeWorktree('/repo/.claude/worktrees/feature-x', true);

      expect(mockRun).toHaveBeenCalledWith(
        '/usr/bin/git',
        ['worktree', 'remove', '--force', '/repo/.claude/worktrees/feature-x'],
        { cwd: '/repo' },
      );
    });

    it('derives repoRoot by stripping /.claude/worktrees/ suffix', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      await adapter.removeWorktree('/Users/me/project/.claude/worktrees/fix-bug', false);

      expect(mockRun).toHaveBeenCalledWith(
        '/usr/bin/git',
        ['worktree', 'remove', '/Users/me/project/.claude/worktrees/fix-bug'],
        { cwd: '/Users/me/project' },
      );
    });

    it('falls back to parent directory when no .claude/worktrees/ in path', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      await adapter.removeWorktree('/repo/.worktrees/feature', false);

      expect(mockRun).toHaveBeenCalledWith(
        '/usr/bin/git',
        ['worktree', 'remove', '/repo/.worktrees/feature'],
        { cwd: '/repo/.worktrees' },
      );
    });

    it('throws WorktreeError on failure', async () => {
      const mockRun = vi.fn().mockResolvedValue({
        succeeded: false,
        stdout: '',
        stderr: 'worktree not found',
        exitCode: 128,
      });

      const adapter = new GitWorktreeAdapter('/usr/bin/git', mockRun);
      await expect(adapter.removeWorktree('/repo/.worktrees/gone', false)).rejects.toThrow(WorktreeError);
    });
  });
});
