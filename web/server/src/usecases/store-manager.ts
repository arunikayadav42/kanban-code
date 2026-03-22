import {
  type AppState,
  type Action,
  type Effect,
  reduce,
  createInitialState,
} from './board-store.js';
import { EffectHandler } from './effect-handler.js';
import { sendAndFlush, queueEvent } from '../sse/state-broadcaster.js';
import { info } from '../infrastructure/logger.js';
import type { SSEEventType } from '@kanban-code/shared';
import { enrichLinks } from '@kanban-code/shared';

/**
 * Manages the server-side AppState, dispatches actions through the Reducer,
 * executes effects, and broadcasts state changes via SSE.
 *
 * This is the web equivalent of the native BoardStore (@Observable @MainActor).
 * Spec: Section 5.1 (Server-Side Reducer)
 */

/**
 * Maps Action types to spec-defined SSE event names (Section 3.2).
 * Actions not in this map are silent (no SSE broadcast).
 */
const ACTION_TO_SSE_EVENT: Record<string, SSEEventType> = {
  // UI card mutations
  createManualTask: 'card:updated',
  moveCard: 'card:updated',
  renameCard: 'card:updated',
  updatePrompt: 'card:updated',
  archiveCard: 'card:updated',
  deleteCard: 'card:deleted',
  reorderCard: 'cards:reordered',
  // Launch/resume
  launchCard: 'card:updated',
  resumeCard: 'card:updated',
  cancelLaunch: 'card:updated',
  launchCompleted: 'launch:completed',
  launchTmuxReady: 'launch:completed',
  launchFailed: 'launch:failed',
  resumeCompleted: 'resume:completed',
  resumeFailed: 'resume:failed',
  // Terminal
  terminalCreated: 'terminal:created',
  terminalFailed: 'terminal:failed',
  extraTerminalCreated: 'terminal:created',
  addExtraTerminal: 'card:updated',
  killTerminal: 'card:updated',
  renameTerminalTab: 'card:updated',
  reorderTerminalTab: 'card:updated',
  // Link management
  unlinkFromCard: 'card:updated',
  addBranchToCard: 'card:updated',
  addIssueLinkToCard: 'card:updated',
  addPRToCard: 'card:updated',
  markPRMerged: 'card:updated',
  // Queued prompts
  addQueuedPrompt: 'card:updated',
  updateQueuedPrompt: 'card:updated',
  removeQueuedPrompt: 'card:updated',
  sendQueuedPrompt: 'card:updated',
  sendDirectPrompt: 'card:updated',
  // Card organization
  bulkArchive: 'card:updated',
  bulkResume: 'card:updated',
  bulkMoveToProject: 'card:updated',
  bulkDelete: 'card:deleted',
  moveCardToProject: 'card:updated',
  moveCardToFolder: 'card:updated',
  mergeCards: 'card:updated',
  // Migration
  beginMigration: 'card:updated',
  migrateSession: 'card:updated',
  migrationFailed: 'migration:failed',
  // Settings / misc
  setError: 'error',
  setLoading: 'loading',
  setIsRefreshingBacklog: 'backlog:refreshing',
  settingsLoaded: 'settings:loaded',
  setRateLimitedRepos: 'github:rate-limited',
  // Background
  reconciled: 'cards:reconciled',
  activityChanged: 'activity:changed',
  gitHubIssuesUpdated: 'github:issues-updated',
};

export class StoreManager {
  private state: AppState;
  private readonly effectHandler: EffectHandler;

  constructor(effectHandler: EffectHandler, initialState?: AppState) {
    this.state = initialState ?? createInitialState();
    this.effectHandler = effectHandler;
  }

  /** Get current state (read-only snapshot). */
  getState(): AppState {
    return this.state;
  }

  /**
   * Dispatch an action through the Reducer.
   * - Reducer produces new state + effects (pure, synchronous)
   * - Effects are executed asynchronously by EffectHandler
   * - State changes are broadcast via SSE
   */
  dispatch(action: Action, options?: { isUserAction?: boolean }): void {
    const { state: newState, effects } = reduce(this.state, action);
    this.state = newState;

    // Map action to spec SSE event name (Section 3.2)
    const sseEvent = ACTION_TO_SSE_EVENT[action.type];
    if (sseEvent) {
      const payload = this.buildEventPayload(action, sseEvent);
      const isUser = options?.isUserAction ?? false;
      if (isUser) {
        sendAndFlush(sseEvent, payload);
      } else {
        queueEvent(sseEvent, payload);
      }
    }

    // Execute effects asynchronously
    for (const effect of effects) {
      this.effectHandler.execute(effect, (followUp) => this.dispatch(followUp)).catch(err => {
        info('store', `Effect ${effect.type} failed: ${err}`);
      });
    }
  }

  /** Build SSE payload matching spec Section 3.2 event shapes. */
  private buildEventPayload(action: Action, event: SSEEventType): Record<string, unknown> {
    const rawState = this.getClientState();
    const links = enrichLinks(rawState.links);
    const state = { ...rawState, links };
    const cardId = 'cardId' in action ? (action as { cardId: string }).cardId : undefined;

    switch (event) {
      case 'card:updated':
        return { cardId, link: cardId ? state.links[cardId] : undefined, state: { links: state.links } };
      case 'card:deleted':
        return { cardId, state: { links: state.links } };
      case 'cards:reordered':
        return { state: { links: state.links } };
      case 'cards:reconciled':
        return { state };
      case 'activity:changed':
        return { activityMap: state.activityMap, state: { activityMap: state.activityMap } };
      case 'launch:completed':
      case 'resume:completed':
        return { cardId, state: { links: state.links } };
      case 'launch:failed':
      case 'resume:failed':
        return { cardId, error: state.error, state: { links: state.links, error: state.error } };
      case 'terminal:created':
        return { cardId, state: { links: state.links } };
      case 'terminal:failed':
        return { cardId, error: state.error, state: { links: state.links, error: state.error } };
      case 'error':
        return { message: state.error, state: { error: state.error } };
      case 'loading':
        return { isLoading: state.isLoading, state: { isLoading: state.isLoading } };
      case 'backlog:refreshing':
        return { isRefreshingBacklog: state.isRefreshingBacklog, state: { isRefreshingBacklog: state.isRefreshingBacklog } };
      case 'settings:loaded':
        return { state: { configuredProjects: state.configuredProjects, excludedPaths: state.excludedPaths } };
      case 'github:issues-updated':
        return { state: { links: state.links, lastGitHubRefresh: state.lastGitHubRefresh } };
      case 'github:rate-limited':
        return { repos: state.rateLimitedRepos, state: { rateLimitedRepos: state.rateLimitedRepos } };
      case 'migration:failed':
        return { cardId, error: state.error, state: { links: state.links, error: state.error } };
      default:
        return { state };
    }
  }

  /** Get state formatted for SSE broadcast. */
  getClientState(): AppState {
    return this.state;
  }

  /** Get state snapshot for SSE initial connection. */
  getSnapshot(): AppState {
    return this.state;
  }
}
