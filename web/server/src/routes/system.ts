import { Router } from 'express';
import type { SettingsStore } from '../infrastructure/settings-store.js';
import type { TmuxManagerPort } from '../domain/ports/tmux-manager.js';
import type { WorktreeManagerPort } from '../domain/ports/worktree-manager.js';
import { checkAll } from '../infrastructure/dependency-checker.js';
import { HookManager } from '../adapters/claude/hook-manager.js';
import type { CodingAssistant } from '@kanban-code/shared';
import { ALL_ASSISTANTS, getAllAssistants, getDescriptor } from '@kanban-code/shared';
import type { GhCliAdapter } from '../adapters/git/gh-cli-adapter.js';
import type { StoreManager } from '../usecases/store-manager.js';
import type { CoordinationStore } from '../infrastructure/coordination-store.js';
import { info } from '../infrastructure/logger.js';

/**
 * System REST endpoints.
 *
 * Spec: Section 3.3 (REST API -- System endpoints)
 *
 * - GET  /api/health             -- dependency status
 * - GET  /api/tmux-sessions      -- live tmux sessions
 * - GET  /api/worktrees          -- git worktrees per configured repo
 * - GET  /api/backlog            -- GitHub issues for configured projects
 * - POST /api/backlog/refresh    -- trigger GitHub issue refresh
 * - POST /api/hooks/install      -- install hooks for assistant
 * - POST /api/hooks/uninstall    -- uninstall hooks
 * - GET  /api/hooks/status       -- check hook installation status
 */

export interface SystemRouteDeps {
  settingsStore: SettingsStore;
  tmuxAdapter: TmuxManagerPort;
  worktreeAdapter: WorktreeManagerPort;
  ghAdapter: GhCliAdapter;
  store?: StoreManager;
  coordinationStore?: CoordinationStore;
  triggerReconciliation?: () => Promise<void>;
  triggerSync?: () => Promise<void>;
}

export function createSystemRoutes(deps: SystemRouteDeps): Router {
  const router = Router();
  const { settingsStore, tmuxAdapter, worktreeAdapter, ghAdapter, store, coordinationStore: coordStore, triggerReconciliation, triggerSync } = deps;

  // GET /api/health -- returns dependency status
  router.get('/health', async (_req, res) => {
    try {
      const status = await checkAll(settingsStore);
      res.json({ status: 'ok', version: '0.1.0', dependencies: status });
    } catch (err) {
      res.status(500).json({ error: 'Health check failed', details: String(err) });
    }
  });

  // GET /api/tmux-sessions -- list live tmux sessions
  router.get('/tmux-sessions', async (_req, res) => {
    try {
      const sessions = await tmuxAdapter.listSessions();
      res.json({ sessions });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list tmux sessions', details: String(err) });
    }
  });

  // GET /api/worktrees -- list git worktrees per configured repo
  router.get('/worktrees', async (_req, res) => {
    try {
      const settings = settingsStore.read();
      const projects = settings.projects ?? [];

      const results: Record<string, { path: string; branch: string | null; isBare: boolean }[]> = {};
      await Promise.all(
        projects.map(async (project) => {
          try {
            const worktrees = await worktreeAdapter.listWorktrees(project.path);
            results[project.path] = worktrees;
          } catch {
            results[project.path] = [];
          }
        }),
      );

      res.json({ worktrees: results });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list worktrees', details: String(err) });
    }
  });

  // GET /api/backlog -- fetch GitHub issues for configured projects
  router.get('/backlog', async (_req, res) => {
    try {
      const settings = settingsStore.read();
      const projects = settings.projects ?? [];
      const filter = settings.github.defaultFilter;

      const allIssues: Array<{
        project: string;
        issues: Array<{ number: number; title: string; body: string | null; url: string; labels: string[] }>;
      }> = [];

      await Promise.all(
        projects.map(async (project) => {
          try {
            const issues = await ghAdapter.fetchIssues(project.path, filter);
            allIssues.push({ project: project.path, issues });
          } catch {
            allIssues.push({ project: project.path, issues: [] });
          }
        }),
      );

      res.json({ backlog: allIssues });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch backlog', details: String(err) });
    }
  });

  // POST /api/backlog/refresh -- trigger GitHub issue refresh
  router.post('/backlog/refresh', async (_req, res) => {
    try {
      const settings = settingsStore.read();
      const projects = settings.projects ?? [];
      const filter = settings.github.defaultFilter;

      const allIssues: Array<{
        project: string;
        issues: Array<{ number: number; title: string; body: string | null; url: string; labels: string[] }>;
      }> = [];

      await Promise.all(
        projects.map(async (project) => {
          try {
            const issues = await ghAdapter.fetchIssues(project.path, filter);
            allIssues.push({ project: project.path, issues });
          } catch {
            allIssues.push({ project: project.path, issues: [] });
          }
        }),
      );

      res.json({ refreshed: true, backlog: allIssues });
    } catch (err) {
      res.status(500).json({ error: 'Failed to refresh backlog', details: String(err) });
    }
  });

  // POST /api/hooks/install -- install hooks for assistant
  router.post('/hooks/install', (req, res) => {
    const assistant = (req.body.assistant || 'claude') as CodingAssistant;
    if (!assistant || !ALL_ASSISTANTS.includes(assistant)) {
      res.status(400).json({ error: `Invalid assistant: ${assistant}` });
      return;
    }

    try {
      HookManager.install({ assistant });
      res.json({ installed: true, assistant });
    } catch (err) {
      res.status(500).json({ error: 'Failed to install hooks', details: String(err) });
    }
  });

  // POST /api/hooks/uninstall -- uninstall hooks
  router.post('/hooks/uninstall', (req, res) => {
    const assistant = (req.body.assistant || 'claude') as CodingAssistant;
    if (!assistant || !ALL_ASSISTANTS.includes(assistant)) {
      res.status(400).json({ error: `Invalid assistant: ${assistant}` });
      return;
    }

    try {
      HookManager.uninstall({ assistant });
      res.json({ uninstalled: true, assistant });
    } catch (err) {
      res.status(500).json({ error: 'Failed to uninstall hooks', details: String(err) });
    }
  });

  // GET /api/hooks/status -- check hook installation status
  router.get('/hooks/status', (_req, res) => {
    try {
      const status: Record<string, boolean> = {};
      for (const assistant of ALL_ASSISTANTS) {
        status[assistant] = HookManager.isInstalled({ assistant });
      }
      res.json({ hooks: status });
    } catch (err) {
      res.status(500).json({ error: 'Failed to check hook status', details: String(err) });
    }
  });

  // GET /api/assistants -- list all registered assistant descriptors (client-safe, no hooks)
  router.get('/assistants', (_req, res) => {
    const descriptors = getAllAssistants().map(id => {
      const desc = getDescriptor(id);
      if (!desc) return null;
      const { hooks, ...clientSafe } = desc;
      return clientSafe;
    }).filter(Boolean);
    res.json({ assistants: descriptors });
  });

  // POST /api/rediscover -- wipe discovered cards and trigger full reconciliation
  router.post('/rediscover', async (_req, res) => {
    if (!store || !coordStore) {
      res.status(500).json({ error: 'Rediscovery not available' });
      return;
    }
    try {
      const state = store.getState();
      const allLinks = Object.values(state.links);
      const kept = allLinks.filter(l => l.source !== 'discovered');
      const wiped = allLinks.length - kept.length;

      // Write only non-discovered cards to disk
      coordStore.writeLinks(kept);
      info('system', `Rediscover: wiped ${wiped} discovered cards, kept ${kept.length}`);

      // Reload cleaned links into state
      const keptMap: Record<string, any> = {};
      for (const l of kept) keptMap[l.id] = l;
      store.dispatch({ type: 'reconciled', result: { links: keptMap } }, { isUserAction: true });

      // Trigger immediate reconciliation to rediscover from disk
      if (triggerReconciliation) {
        await triggerReconciliation();
      }

      res.json({ wiped, kept: kept.length });
    } catch (err) {
      res.status(500).json({ error: 'Rediscovery failed', details: String(err) });
    }
  });

  // POST /api/sync -- trigger full reconciliation including PR fetching
  router.post('/sync', async (_req, res) => {
    try {
      if (triggerSync) {
        await triggerSync();
        res.json({ ok: true });
      } else {
        res.status(503).json({ error: 'Sync not available' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Sync failed', details: String(err) });
    }
  });

  return router;
}
