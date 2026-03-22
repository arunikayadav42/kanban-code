import type { Link, ActivityState, PullRequest } from '@kanban-code/shared';
import { getDisplayTitle } from '@kanban-code/shared';
import type { SessionDiscovery } from '../domain/ports/session-discovery.js';
import type { ActivityDetector, HookEvent } from '../domain/ports/activity-detector.js';
import type { PRTrackerPort } from '../domain/ports/pr-tracker.js';
import type { NotifierPort } from '../domain/ports/notifier.js';
import type { TmuxManagerPort } from '../domain/ports/tmux-manager.js';
import type { WorktreeManagerPort } from '../domain/ports/worktree-manager.js';
import { CoordinationStore } from '../infrastructure/coordination-store.js';
import { SettingsStore } from '../infrastructure/settings-store.js';
import { HookEventStore } from '../adapters/claude/hook-event-store.js';
import { HookManager } from '../adapters/claude/hook-manager.js';
import { NotificationDeduplicator } from '../adapters/notifications/notification-deduplicator.js';
import { JsonlParser } from '../adapters/claude/jsonl-parser.js';
import { reconcile as reconcileCards, createDiscoverySnapshot } from './card-reconciler.js';
import { findUnconfiguredPaths } from './project-discovery.js';
import { updateCardColumn } from './update-card-column.js';
import { info, warn } from '../infrastructure/logger.js';

/**
 * Coordinates all background processes: session discovery, tmux polling,
 * hook event processing, activity detection, PR tracking, and link management.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/BackgroundOrchestrator.swift (391 lines)
 * Spec: Section 7.6 (backgroundTickInterval=5s, hookProcessingDelay=500ms, autoSendDelay=500ms)
 */

export type DispatchFn = (action: { type: string; [key: string]: unknown }) => void;

export class BackgroundOrchestrator {
  isRunning = false;

  private readonly discovery: SessionDiscovery;
  private readonly coordinationStore: CoordinationStore;
  private readonly settingsStore: SettingsStore | null;
  private readonly activityDetector: ActivityDetector;
  private readonly hookEventStore: HookEventStore;
  private readonly tmux: TmuxManagerPort | null;
  private readonly worktreeAdapter: WorktreeManagerPort | null;
  private readonly prTracker: PRTrackerPort | null;
  private readonly notificationDedup: NotificationDeduplicator;
  private notifier: NotifierPort | null;

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private didInitialLoad = false;
  private dispatch: DispatchFn | null = null;
  private syncRequested = false;

  /** Prompt IDs currently being edited in the UI -- skip auto-send for these. */
  private editingQueuedPromptIds = new Set<string>();

  constructor(options: {
    discovery: SessionDiscovery;
    coordinationStore: CoordinationStore;
    settingsStore?: SettingsStore | null;
    activityDetector: ActivityDetector;
    hookEventStore?: HookEventStore;
    tmux?: TmuxManagerPort | null;
    worktreeAdapter?: WorktreeManagerPort | null;
    prTracker?: PRTrackerPort | null;
    notificationDedup?: NotificationDeduplicator;
    notifier?: NotifierPort | null;
  }) {
    this.discovery = options.discovery;
    this.coordinationStore = options.coordinationStore;
    this.settingsStore = options.settingsStore ?? null;
    this.activityDetector = options.activityDetector;
    this.hookEventStore = options.hookEventStore ?? new HookEventStore();
    this.tmux = options.tmux ?? null;
    this.worktreeAdapter = options.worktreeAdapter ?? null;
    this.prTracker = options.prTracker ?? null;
    this.notificationDedup = options.notificationDedup ?? new NotificationDeduplicator();
    this.notifier = options.notifier ?? null;
  }

  /** Start the slow background loop (columns, PRs, activity polling). */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initial tick
    this.backgroundTick().catch(() => { /* continue on error */ });

    // 5s tick interval (spec 7.6)
    this.tickInterval = setInterval(() => {
      this.backgroundTick().catch(() => { /* continue on error */ });
    }, 5000);
  }

  /** Update the notifier (e.g. when settings change). */
  updateNotifier(newNotifier: NotifierPort | null): void {
    this.notifier = newNotifier;
  }

  /** Mark a queued prompt as being edited -- auto-send will skip it. */
  markPromptEditing(promptId: string): void {
    this.editingQueuedPromptIds.add(promptId);
  }

  /** Clear the editing mark so auto-send can proceed. */
  clearPromptEditing(promptId: string): void {
    this.editingQueuedPromptIds.delete(promptId);
  }

  /** Set the dispatch callback for sending actions to the BoardStore. */
  setDispatch(dispatch: DispatchFn): void {
    this.dispatch = dispatch;
  }

  /**
   * Force re-scan a card's conversation for pushed branches and re-fetch PRs.
   * Returns the updated Link so callers can sync it to in-memory state.
   */
  async discoverBranchesForCard(cardId: string): Promise<Link | null> {
    try {
      const links = this.coordinationStore.readLinks();
      const idx = links.findIndex(l => l.id === cardId);
      if (idx < 0) return null;

      let link = links[idx];
      if (!link.sessionLink?.sessionPath) return null;

      // Clear overrides for full rescan — Swift: BackgroundOrchestrator.swift:91-100
      link = {
        ...link,
        manualOverrides: {
          ...link.manualOverrides,
          branchWatermark: null,
          worktreePath: false,
          prLink: false,
          dismissedPRs: null,
        },
        discoveredBranches: null,
        discoveredRepos: null,
        updatedAt: new Date().toISOString(),
      };

      // Extract branches from session transcript — Swift: BackgroundOrchestrator.swift:102-115
      let branches: Array<{ branch: string; repoPath?: string | null }> = [];
      try {
        branches = await JsonlParser.extractPushedBranches(link.sessionLink!.sessionPath);
      } catch {
        // Session file may not exist yet (launch in progress)
      }
      const branchNames = branches.map(b => b.branch);
      const repos: Record<string, string> = {};
      for (const b of branches) {
        if (b.repoPath) repos[b.branch] = b.repoPath;
      }

      link.discoveredBranches = branchNames.length > 0 ? branchNames : [];
      link.discoveredRepos = Object.keys(repos).length > 0 ? repos : null;

      // Fetch PRs from each discovered repo — Swift: BackgroundOrchestrator.swift:117-140
      if (this.prTracker) {
        const repoRoots = new Set<string>();
        if (link.projectPath) repoRoots.add(link.projectPath);
        for (const repoPath of Object.values(repos)) repoRoots.add(repoPath);

        for (const repoRoot of repoRoots) {
          try {
            const prs = await this.prTracker.fetchPRs(repoRoot);
            for (const [branch, pr] of Object.entries(prs)) {
              if (branchNames.includes(branch)) {
                const existing = link.prLinks.find(p => p.number === pr.number);
                if (!existing) {
                  link.prLinks = [...link.prLinks, { number: pr.number, url: pr.url }];
                }
              }
            }
          } catch {
            warn('orchestrator', `Failed to fetch PRs for ${repoRoot}`);
          }
        }
      }

      // Recompute column — Swift: BackgroundOrchestrator.swift:142-150
      const activity = this.activityDetector
        ? await this.activityDetector.activityState(link.sessionLink?.sessionId ?? '')
        : undefined;
      const hasWorktree = link.worktreeLink?.branch != null;
      link = updateCardColumn(link, activity, hasWorktree);

      links[idx] = link;
      this.coordinationStore.writeLinks(links);
      info('orchestrator', `Discovered ${branchNames.length} branches for card=${cardId.substring(0, 12)}`);
      return link;
    } catch (err) {
      warn('orchestrator', `discoverBranchesForCard failed: ${err}`);
      return null;
    }
  }

  /** Stop the background loop. */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.isRunning = false;
  }

  // MARK: - Event-driven notification path

  /**
   * Process new hook events and send notifications.
   * Called directly by file watcher for instant response.
   */
  async processHookEvents(): Promise<void> {
    try {
      const events = this.hookEventStore.readNewEvents();

      if (!this.didInitialLoad) {
        info('notify', `Initial load: consuming ${events.length} old events`);
        for (const event of events) {
          await this.activityDetector.handleHookEvent(event);
        }
        await this.activityDetector.resolvePendingStops();
        this.notificationDedup.clearAllPending();
        this.didInitialLoad = true;
        return;
      }

      if (events.length > 0) {
        info('notify', `Processing ${events.length} hook events`);
      }

      for (const event of events) {
        await this.activityDetector.handleHookEvent(event);

        const eventName = HookManager.normalizeEventName(event.eventName);
        switch (eventName) {
          case 'Stop': {
            info('notify', `Stop event for session ${event.sessionId.substring(0, 8)} at ${event.timestamp}`);
            const stopTime = new Date(event.timestamp);
            const sessionId = event.sessionId;

            // 500ms delay before checking (spec 7.6)
            setTimeout(() => {
              (async () => {
                const prompted = this.notificationDedup.hasPromptedWithin(
                  sessionId, stopTime,
                );
                if (prompted) {
                  info('notify', 'Stop skipped: user prompted within 0.5s after stop');
                  return;
                }
                await this.doNotify(sessionId);

                // Auto-send queued prompt: wait 500ms more (1s total from Stop)
                setTimeout(() => {
                  (async () => {
                    const promptedAgain = this.notificationDedup.hasPromptedWithin(
                      sessionId, stopTime,
                    );
                    if (promptedAgain) {
                      info('notify', 'Auto-send skipped: user prompted after stop');
                      return;
                    }
                    await this.autoSendQueuedPrompt(sessionId);
                  })().catch(err => warn('orchestrator', `Auto-send failed: ${err}`));
                }, 500);
              })().catch(err => warn('orchestrator', `Stop notification failed: ${err}`));
            }, 500);
            break;
          }

          case 'Notification': {
            info('notify', `Notification event for session ${event.sessionId.substring(0, 8)} at ${event.timestamp}`);
            const sessionId = event.sessionId;
            const eventTime = new Date(event.timestamp);

            // Notification events go through 62s dedup
            const shouldNotify = this.notificationDedup.shouldNotify(
              sessionId, eventTime,
            );
            if (!shouldNotify) {
              info('notify', `Notification deduped for ${sessionId.substring(0, 8)}`);
              break;
            }
            await this.doNotify(sessionId);
            break;
          }

          case 'UserPromptSubmit': {
            info('notify', `UserPromptSubmit for session ${event.sessionId.substring(0, 8)} at ${event.timestamp}`);
            this.notificationDedup.recordPrompt(event.sessionId, new Date(event.timestamp));
            break;
          }

          default:
            break;
        }
      }
    } catch (error) {
      info('notify', `processHookEvents error: ${error}`);
    }
  }

  // MARK: - Private

  /** Send notification -- no dedup check, just format and send. */
  private async doNotify(sessionId: string): Promise<void> {
    if (!this.notifier) {
      info('notify', 'Notification skipped: notifier is nil');
      return;
    }

    const link = this.coordinationStore.linkForSession(sessionId);
    const title = link ? getDisplayTitle(link) : 'Session done';
    let message = 'Waiting for input';

    try {
      await this.notifier.sendNotification(title, message, null, link?.id ?? null);
    } catch {
      // Best-effort
    }
  }

  /** Auto-send the first queued prompt with sendAutomatically=true for a session. */
  private async autoSendQueuedPrompt(sessionId: string): Promise<void> {
    try {
      const link = this.coordinationStore.linkForSession(sessionId);
      if (!link) return;

      const prompt = link.queuedPrompts?.find(
        p => p.sendAutomatically && !this.editingQueuedPromptIds.has(p.id),
      );
      if (!prompt) return;
      if (!link.tmuxLink?.sessionName) {
        info('notify', `Auto-send skipped: no tmux session for ${sessionId.substring(0, 8)}`);
        return;
      }

      info('notify', `Auto-sending queued prompt to ${sessionId.substring(0, 8)}: ${prompt.body.substring(0, 40)}...`);

      if (this.dispatch) {
        this.dispatch({ type: 'sendQueuedPrompt', cardId: link.id, promptId: prompt.id });
      }

      // Record that we "prompted" so the next stop can trigger the next queued prompt
      this.notificationDedup.recordPrompt(sessionId, new Date());
    } catch (error) {
      warn('notify', `autoSendQueuedPrompt failed: ${error}`);
    }
  }

  /**
   * Slow background tick: poll activity states for sessions without hook events.
   * Full reconciliation: discover sessions, tmux, worktrees, PRs, reconcile cards.
   * Matches Swift BackgroundOrchestrator's refresh() cycle.
   */
  /** Trigger an immediate reconciliation tick (used by rediscover endpoint). */
  async triggerTick(): Promise<void> {
    return this.backgroundTick();
  }

  /** Request a full sync including PR fetching on the next tick. */
  async triggerSync(): Promise<void> {
    this.syncRequested = true;
    return this.backgroundTick();
  }

  private async backgroundTick(): Promise<void> {
    // Process hook events first (Stop → needsAttention, UserPromptSubmit → activelyWorking)
    try {
      await this.processHookEvents();
    } catch { /* continue */ }

    const start = Date.now();
    try {
      // 1. Read existing cards
      const existingLinks = this.coordinationStore.readLinks();
      const existingMap: Record<string, Link> = {};
      for (const link of existingLinks) existingMap[link.id] = link;

      // 2. Discover sessions (Claude + Gemini + Kiro)
      let sessions: Awaited<ReturnType<SessionDiscovery['discoverSessions']>> = [];
      try {
        sessions = await this.discovery.discoverSessions();
        info('reconcile', `discoverSessions: ${((Date.now() - start) / 1000).toFixed(3)} seconds (${sessions.length} sessions)`);
      } catch { /* continue without sessions */ }

      // 3. Read settings for configured projects
      const settings = this.settingsStore ? this.settingsStore.read() : null;
      const configuredProjects = settings?.projects ?? [];

      // 4. List tmux sessions
      let tmuxSessions: Array<{ name: string; path: string; attached: boolean }> = [];
      let didScanTmux = false;
      try {
        if (this.tmux) {
          tmuxSessions = await this.tmux.listSessions();
          didScanTmux = true;
          info('reconcile', `tmux: ${((Date.now() - start) / 1000).toFixed(3)} seconds (${tmuxSessions.length} sessions)`);
        }
      } catch { /* continue without tmux */ }

      // 5. List worktrees per configured project
      const worktrees: Record<string, Array<{ path: string; branch: string | null; isBare: boolean }>> = {};
      if (this.worktreeAdapter) {
        for (const project of configuredProjects) {
          try {
            const wts = await this.worktreeAdapter.listWorktrees(project.repoRoot ?? project.path);
            worktrees[project.repoRoot ?? project.path] = wts;
          } catch { /* skip this repo */ }
        }
        info('reconcile', `worktrees: ${((Date.now() - start) / 1000).toFixed(3)} seconds (${Object.values(worktrees).flat().length} across ${Object.keys(worktrees).length} repos)`);
      }

      // 6. Fetch PRs per repo (only on manual sync, not every 5s tick)
      const pullRequests: Record<string, PullRequest> = {};
      if (this.prTracker && this.syncRequested) {
        this.syncRequested = false;
        for (const project of configuredProjects) {
          try {
            const prs = await this.prTracker.fetchPRs(project.repoRoot ?? project.path);
            for (const [branch, pr] of Object.entries(prs)) {
              pullRequests[branch] = pr as any;
            }
          } catch { /* skip */ }
        }
      }

      // 7. Run CardReconciler
      const snapshot = createDiscoverySnapshot({
        sessions,
        tmuxSessions,
        didScanTmux,
        worktrees,
        pullRequests,
      });
      const reconciled = reconcileCards(existingLinks, snapshot);
      info('reconcile', `reconciler: ${((Date.now() - start) / 1000).toFixed(3)} seconds (${existingLinks.length} existing → ${reconciled.length} merged)`);

      // 8. Poll activity
      const sessionPaths: Record<string, string> = {};
      for (const link of reconciled) {
        const sid = link.sessionLink?.sessionId;
        const p = link.sessionLink?.sessionPath;
        if (sid && p) sessionPaths[sid] = p;
      }
      const polledMap = await this.activityDetector.pollActivity(sessionPaths);
      // Override with hook-aware activityState() — pollActivity alone never returns
      // 'actively_working', so cards would never reach 'in_progress' without this.
      const activityMap: Record<string, import('@kanban-code/shared').ActivityState> = {};
      for (const sid of Object.keys(polledMap)) {
        activityMap[sid] = await this.activityDetector.activityState(sid);
      }
      info('reconcile', `activityMap: ${((Date.now() - start) / 1000).toFixed(3)} seconds (${Object.keys(activityMap).length} active)`);

      // 9. Build reconciled links map + sessions map
      const linksMap: Record<string, Link> = {};
      for (const link of reconciled) linksMap[link.id] = link;
      const sessionsMap: Record<string, (typeof sessions)[0]> = {};
      for (const s of sessions) sessionsMap[s.id] = s;

      // 10. Dispatch reconciled action
      if (this.dispatch) {
        this.dispatch({
          type: 'reconciled',
          result: {
            links: linksMap,
            sessions: sessionsMap,
            activityMap,
            tmuxSessions: tmuxSessions.map(s => s.name),
            configuredProjects,
            excludedPaths: settings?.globalView?.excludedPaths ?? [],
            discoveredProjectPaths: findUnconfiguredPaths(
              sessions.map(s => s.projectPath ?? null),
              configuredProjects,
            ),
          },
        });
        info('reconcile', `dispatch: ${((Date.now() - start) / 1000).toFixed(3)} seconds`);
      }

      // 11. GitHub issues (less frequent — skip if last fetch was < 60s ago)
      if (this.prTracker && settings?.github) {
        try {
          // GitHub issue fetch handled by dedicated route, not here
        } catch { /* skip */ }
      }

      info('reconcile', `TOTAL: ${((Date.now() - start) / 1000).toFixed(3)} seconds`);
    } catch (err) {
      warn('reconcile', `backgroundTick failed: ${err}`);
    }
  }
}
