import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { SettingsStore } from '../../infrastructure/settings-store.js';
import { createSystemRoutes, type SystemRouteDeps } from '../system.js';
import type { TmuxManagerPort } from '../../domain/ports/tmux-manager.js';
import type { WorktreeManagerPort } from '../../domain/ports/worktree-manager.js';
import type { TmuxSession, Worktree } from '@kanban-code/shared';
import { HookManager } from '../../adapters/claude/hook-manager.js';
import type { GhCliAdapter, GitHubIssue } from '../../adapters/git/gh-cli-adapter.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockTmuxAdapter(sessions: TmuxSession[] = []): TmuxManagerPort {
  return {
    listSessions: vi.fn().mockResolvedValue(sessions),
    createSession: vi.fn().mockResolvedValue(undefined),
    killSession: vi.fn().mockResolvedValue(undefined),
    findSessionForWorktree: vi.fn().mockReturnValue(null),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    pastePrompt: vi.fn().mockResolvedValue(undefined),
    capturePane: vi.fn().mockResolvedValue(''),
    sendBracketedPaste: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

function createMockWorktreeAdapter(
  worktreesByRepo: Record<string, Worktree[]> = {},
): WorktreeManagerPort {
  return {
    listWorktrees: vi.fn().mockImplementation(async (repoRoot: string) => {
      return worktreesByRepo[repoRoot] ?? [];
    }),
    createWorktree: vi.fn().mockResolvedValue({ path: '/wt', branch: 'main', isBare: false }),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockGhAdapter(
  issuesByRepo: Record<string, GitHubIssue[]> = {},
): GhCliAdapter {
  return {
    fetchPRs: vi.fn().mockResolvedValue({}),
    enrichPRDetails: vi.fn().mockResolvedValue({}),
    batchPRLookup: vi.fn().mockResolvedValue({ byBranch: {}, byNumber: {} }),
    fetchPRBody: vi.fn().mockResolvedValue(null),
    fetchIssues: vi.fn().mockImplementation(async (repoRoot: string) => {
      return issuesByRepo[repoRoot] ?? [];
    }),
    mergePR: vi.fn().mockResolvedValue({ type: 'success', warning: null }),
    isAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as GhCliAdapter;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('System Routes', () => {
  let app: express.Express;
  let tempDir: string;
  let settingsStore: SettingsStore;

  function setup(overrides?: Partial<SystemRouteDeps>) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-system-'));
    settingsStore = new SettingsStore(tempDir);

    const deps: SystemRouteDeps = {
      settingsStore,
      tmuxAdapter: createMockTmuxAdapter(),
      worktreeAdapter: createMockWorktreeAdapter(),
      ghAdapter: createMockGhAdapter(),
      ...overrides,
    };

    app = express();
    app.use(express.json());
    app.use('/api', createSystemRoutes(deps));

    return deps;
  }

  // -----------------------------------------------------------------------
  // GET /api/health
  // -----------------------------------------------------------------------

  describe('GET /api/health', () => {
    it('returns ok status with dependencies', async () => {
      setup();
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.version).toBe('0.1.0');
      expect(res.body.dependencies).toBeDefined();
      expect(typeof res.body.dependencies.tmuxAvailable).toBe('boolean');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/tmux-sessions
  // -----------------------------------------------------------------------

  describe('GET /api/tmux-sessions', () => {
    it('returns empty sessions list when none exist', async () => {
      setup();
      const res = await request(app).get('/api/tmux-sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions).toEqual([]);
    });

    it('returns live tmux sessions', async () => {
      const sessions: TmuxSession[] = [
        { name: 'kanban-main', path: '/Users/dev/project', attached: true },
        { name: 'kanban-feat', path: '/Users/dev/feat', attached: false },
      ];
      setup({ tmuxAdapter: createMockTmuxAdapter(sessions) });

      const res = await request(app).get('/api/tmux-sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(2);
      expect(res.body.sessions[0].name).toBe('kanban-main');
      expect(res.body.sessions[0].attached).toBe(true);
      expect(res.body.sessions[1].name).toBe('kanban-feat');
    });

    it('returns 500 when tmux adapter throws', async () => {
      const failingAdapter = createMockTmuxAdapter();
      (failingAdapter.listSessions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('tmux not found'));
      setup({ tmuxAdapter: failingAdapter });

      const res = await request(app).get('/api/tmux-sessions');
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Failed to list tmux sessions/);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/worktrees
  // -----------------------------------------------------------------------

  describe('GET /api/worktrees', () => {
    it('returns empty worktrees when no projects configured', async () => {
      setup();
      const res = await request(app).get('/api/worktrees');
      expect(res.status).toBe(200);
      expect(res.body.worktrees).toEqual({});
    });

    it('returns worktrees for each configured project', async () => {
      const worktreesByRepo: Record<string, Worktree[]> = {
        '/Users/dev/alpha': [
          { path: '/Users/dev/alpha', branch: 'main', isBare: false },
          { path: '/Users/dev/alpha/.worktrees/feat', branch: 'feat', isBare: false },
        ],
        '/Users/dev/beta': [
          { path: '/Users/dev/beta', branch: 'main', isBare: false },
        ],
      };

      setup({ worktreeAdapter: createMockWorktreeAdapter(worktreesByRepo) });

      // Configure projects in settings
      const settings = settingsStore.read();
      settings.projects = [
        { path: '/Users/dev/alpha', name: 'alpha', visible: true },
        { path: '/Users/dev/beta', name: 'beta', visible: true },
      ];
      settingsStore.write(settings);

      const res = await request(app).get('/api/worktrees');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.worktrees)).toHaveLength(2);
      expect(res.body.worktrees['/Users/dev/alpha']).toHaveLength(2);
      expect(res.body.worktrees['/Users/dev/beta']).toHaveLength(1);
    });

    it('returns empty array for repos where listing fails', async () => {
      const adapter = createMockWorktreeAdapter();
      (adapter.listWorktrees as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('git error'));
      setup({ worktreeAdapter: adapter });

      const settings = settingsStore.read();
      settings.projects = [{ path: '/bad/repo', name: 'bad', visible: true }];
      settingsStore.write(settings);

      const res = await request(app).get('/api/worktrees');
      expect(res.status).toBe(200);
      expect(res.body.worktrees['/bad/repo']).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/backlog
  // -----------------------------------------------------------------------

  describe('GET /api/backlog', () => {
    it('returns empty backlog when no projects configured', async () => {
      setup();
      const res = await request(app).get('/api/backlog');
      expect(res.status).toBe(200);
      expect(res.body.backlog).toEqual([]);
    });

    it('returns issues for configured projects', async () => {
      const issuesByRepo: Record<string, GitHubIssue[]> = {
        '/Users/dev/alpha': [
          { number: 1, title: 'Fix bug', body: 'Details', url: 'https://github.com/org/alpha/issues/1', labels: ['bug'] },
          { number: 2, title: 'Add feature', body: null, url: 'https://github.com/org/alpha/issues/2', labels: [] },
        ],
      };

      setup({ ghAdapter: createMockGhAdapter(issuesByRepo) });

      const settings = settingsStore.read();
      settings.projects = [{ path: '/Users/dev/alpha', name: 'alpha', visible: true }];
      settingsStore.write(settings);

      const res = await request(app).get('/api/backlog');
      expect(res.status).toBe(200);
      expect(res.body.backlog).toHaveLength(1);
      expect(res.body.backlog[0].project).toBe('/Users/dev/alpha');
      expect(res.body.backlog[0].issues).toHaveLength(2);
      expect(res.body.backlog[0].issues[0].title).toBe('Fix bug');
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/backlog/refresh
  // -----------------------------------------------------------------------

  describe('POST /api/backlog/refresh', () => {
    it('returns refreshed: true with backlog data', async () => {
      setup();
      const res = await request(app).post('/api/backlog/refresh');
      expect(res.status).toBe(200);
      expect(res.body.refreshed).toBe(true);
      expect(res.body.backlog).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/hooks/install
  // -----------------------------------------------------------------------

  describe('POST /api/hooks/install', () => {
    it('installs hooks for claude by default', async () => {
      setup();

      // We need to mock HookManager.install to avoid touching the real filesystem
      const installSpy = vi.spyOn(HookManager, 'install').mockImplementation(() => {});
      try {
        const res = await request(app).post('/api/hooks/install').send({});
        expect(res.status).toBe(200);
        expect(res.body.installed).toBe(true);
        expect(res.body.assistant).toBe('claude');
        expect(installSpy).toHaveBeenCalledWith({ assistant: 'claude' });
      } finally {
        installSpy.mockRestore();
      }
    });

    it('installs hooks for specified assistant', async () => {
      setup();
      const installSpy = vi.spyOn(HookManager, 'install').mockImplementation(() => {});
      try {
        const res = await request(app).post('/api/hooks/install').send({ assistant: 'gemini' });
        expect(res.status).toBe(200);
        expect(res.body.assistant).toBe('gemini');
        expect(installSpy).toHaveBeenCalledWith({ assistant: 'gemini' });
      } finally {
        installSpy.mockRestore();
      }
    });

    it('returns 400 for invalid assistant', async () => {
      setup();
      const res = await request(app).post('/api/hooks/install').send({ assistant: 'invalid' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid assistant/);
    });

    it('returns 500 when install fails', async () => {
      setup();
      const installSpy = vi.spyOn(HookManager, 'install').mockImplementation(() => {
        throw new Error('Permission denied');
      });
      try {
        const res = await request(app).post('/api/hooks/install').send({});
        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Failed to install hooks/);
      } finally {
        installSpy.mockRestore();
      }
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/hooks/uninstall
  // -----------------------------------------------------------------------

  describe('POST /api/hooks/uninstall', () => {
    it('uninstalls hooks for claude by default', async () => {
      setup();
      const uninstallSpy = vi.spyOn(HookManager, 'uninstall').mockImplementation(() => {});
      try {
        const res = await request(app).post('/api/hooks/uninstall').send({});
        expect(res.status).toBe(200);
        expect(res.body.uninstalled).toBe(true);
        expect(res.body.assistant).toBe('claude');
      } finally {
        uninstallSpy.mockRestore();
      }
    });

    it('returns 400 for invalid assistant', async () => {
      setup();
      const res = await request(app).post('/api/hooks/uninstall').send({ assistant: 'copilot' });
      expect(res.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/hooks/status
  // -----------------------------------------------------------------------

  describe('GET /api/hooks/status', () => {
    it('returns hook installation status for all assistants', async () => {
      setup();
      const isInstalledSpy = vi.spyOn(HookManager, 'isInstalled').mockReturnValue(false);
      try {
        const res = await request(app).get('/api/hooks/status');
        expect(res.status).toBe(200);
        expect(res.body.hooks).toBeDefined();
        expect(typeof res.body.hooks.claude).toBe('boolean');
        expect(typeof res.body.hooks.gemini).toBe('boolean');
      } finally {
        isInstalledSpy.mockRestore();
      }
    });

    it('reflects when hooks are installed', async () => {
      setup();
      const isInstalledSpy = vi.spyOn(HookManager, 'isInstalled').mockImplementation(
        ({ assistant }) => assistant === 'claude',
      );
      try {
        const res = await request(app).get('/api/hooks/status');
        expect(res.body.hooks.claude).toBe(true);
        expect(res.body.hooks.gemini).toBe(false);
      } finally {
        isInstalledSpy.mockRestore();
      }
    });
  });
});
