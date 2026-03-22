import { describe, it, expect, vi } from 'vitest';
import { LaunchSession, tmuxSessionName } from '../launch-session.js';
import type { TmuxManagerPort } from '../../domain/ports/tmux-manager.js';

// Mock tmux adapter
function mockTmux(): TmuxManagerPort & { calls: { method: string; args: any[] }[] } {
  const calls: { method: string; args: any[] }[] = [];
  return {
    calls,
    listSessions: async () => [],
    createSession: async (name, path, command) => { calls.push({ method: 'createSession', args: [name, path, command] }); },
    killSession: async (name) => { calls.push({ method: 'killSession', args: [name] }); },
    findSessionForWorktree: () => null,
    sendPrompt: async () => {},
    pastePrompt: async () => {},
    capturePane: async () => '',
    sendBracketedPaste: async () => {},
    isAvailable: async () => true,
  };
}

describe('LaunchSession', () => {
  describe('launch', () => {
    it('builds claude command with skip permissions', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/Users/me/repo',
        prompt: 'Fix the bug',
        skipPermissions: true,
        assistant: 'claude',
      });

      const createCall = tmux.calls.find(c => c.method === 'createSession');
      expect(createCall).toBeDefined();
      const command = createCall!.args[2] as string;
      expect(command).toContain('claude --dangerously-skip-permissions');
      expect(command).toContain("cd '/Users/me/repo'");
    });

    it('builds gemini command with --yolo', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/tmp',
        prompt: 'Fix it',
        skipPermissions: true,
        assistant: 'gemini',
      });

      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).toContain('gemini --yolo');
      expect(command).not.toContain('claude');
    });

    it('adds --worktree flag for claude', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/tmp',
        prompt: 'Fix it',
        worktreeName: 'feature-x',
        assistant: 'claude',
      });

      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).toContain('--worktree feature-x');
    });

    it('ignores --worktree for gemini (not supported)', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/tmp',
        prompt: 'Fix it',
        worktreeName: 'feature-x',
        assistant: 'gemini',
      });

      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).not.toContain('--worktree');
    });

    it('uses commandOverride when provided', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/tmp',
        prompt: 'Fix it',
        commandOverride: 'aider --model gpt-4',
        assistant: 'claude',
      });

      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).toContain('aider --model gpt-4');
      expect(command).not.toContain('claude');
    });

    it('kills stale session before creating', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/tmp',
        prompt: 'Fix it',
        assistant: 'claude',
      });

      // killSession should be called before createSession
      const killIdx = tmux.calls.findIndex(c => c.method === 'killSession');
      const createIdx = tmux.calls.findIndex(c => c.method === 'createSession');
      expect(killIdx).toBeLessThan(createIdx);
    });

    it('adds shell override and extra env', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/tmp',
        prompt: 'Fix it',
        shellOverride: '/bin/custom-shell',
        extraEnv: { KANBAN_CODE_CARD_ID: 'card_123' },
        assistant: 'claude',
      });

      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).toContain('SHELL=/bin/custom-shell');
      expect(command).toContain("KANBAN_CODE_CARD_ID='card_123'");
    });

    it('adds preamble before command', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      await launcher.launch({
        sessionName: 'proj-abc',
        projectPath: '/tmp',
        prompt: 'Fix it',
        preamble: 'export CUSTOM=1',
        assistant: 'claude',
      });

      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).toContain('export CUSTOM=1');
      expect(command).toMatch(/export CUSTOM=1 && .*claude/);
    });
  });

  describe('resume', () => {
    it('builds resume command with session ID', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      const sessionName = await launcher.resume({
        sessionId: 'abcdef12-3456-7890',
        projectPath: '/tmp',
        assistant: 'claude',
      });

      expect(sessionName).toBe('claude-abcdef12');
      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).toContain('claude --resume abcdef12-3456-7890');
    });

    it('uses gemini prefix for gemini assistant', async () => {
      const tmux = mockTmux();
      const launcher = new LaunchSession(tmux);

      const sessionName = await launcher.resume({
        sessionId: '1250be89-48ad-4418',
        projectPath: '/tmp',
        assistant: 'gemini',
      });

      expect(sessionName).toBe('gemini-1250be89');
      const command = tmux.calls.find(c => c.method === 'createSession')!.args[2] as string;
      expect(command).toContain('gemini --resume 1250be89-48ad-4418');
    });

    it('kills stale session matching sessionId prefix', async () => {
      const tmux = mockTmux();
      // Simulate existing session
      tmux.listSessions = async () => [
        { name: 'claude-abcdef12', path: '/tmp', attached: false },
      ];
      const launcher = new LaunchSession(tmux);

      await launcher.resume({
        sessionId: 'abcdef12-3456-7890',
        projectPath: '/tmp',
        assistant: 'claude',
      });

      const killCall = tmux.calls.find(c => c.method === 'killSession');
      expect(killCall).toBeDefined();
      expect(killCall!.args[0]).toBe('claude-abcdef12');
    });
  });

  describe('tmuxSessionName', () => {
    it('returns project name', () => {
      expect(tmuxSessionName('/Users/me/repo')).toBe('repo');
    });

    it('returns project-worktree when worktree provided', () => {
      expect(tmuxSessionName('/Users/me/repo', 'feature-x')).toBe('repo-feature-x');
    });
  });
});
