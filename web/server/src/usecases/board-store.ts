import type {
  Link, Session, ActivityState, KanbanCodeColumn, Project,
  CodingAssistant, QueuedPrompt, IssueLink, PRLink,
} from '@kanban-code/shared';
import { createLink, createDefaultManualOverrides, getSupportsImageUpload, getEffectiveAssistant, mergeBlocked, getTmuxAllSessionNames } from '@kanban-code/shared';
import type { RemoteSettings } from '../infrastructure/settings-store.js';
import { generate } from '../infrastructure/ksuid.js';
import { updateCardColumn } from './update-card-column.js';
import fs from 'fs';

/**
 * AppState + Action + Reducer + Effect — Elm-like unidirectional state management.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/BoardStore.swift (1270 lines)
 * Spec: Section 5.1 (Server-Side Reducer)
 *
 * All 51 Actions ported from Swift.
 */

// MARK: - AppState

export interface AppState {
  links: Record<string, Link>;                    // cardId -> Link
  sessions: Record<string, Session>;              // sessionId -> Session
  activityMap: Record<string, ActivityState>;      // sessionId -> activity
  tmuxSessions: string[];                         // live tmux session names
  selectedCardId: string | null;
  selectedProjectPath: string | null;
  paletteOpen: boolean;
  detailExpanded: boolean;
  error: string | null;
  isLoading: boolean;
  lastRefresh: string | null;                     // ISO8601
  configuredProjects: Project[];
  excludedPaths: string[];
  discoveredProjectPaths: string[];
  lastGitHubRefresh: string | null;               // ISO8601
  isRefreshingBacklog: boolean;
  rateLimitedRepos: string[];
  deletedSessionIds: string[];
  deletedCardIds: string[];
  busyCards: string[];
  globalRemoteSettings: RemoteSettings | null;
}

export function createInitialState(): AppState {
  return {
    links: {},
    sessions: {},
    activityMap: {},
    tmuxSessions: [],
    selectedCardId: null,
    selectedProjectPath: null,
    paletteOpen: false,
    detailExpanded: false,
    error: null,
    isLoading: false,
    lastRefresh: null,
    configuredProjects: [],
    excludedPaths: [],
    discoveredProjectPaths: [],
    lastGitHubRefresh: null,
    isRefreshingBacklog: false,
    rateLimitedRepos: [],
    deletedSessionIds: [],
    deletedCardIds: [],
    busyCards: [],
    globalRemoteSettings: null,
  };
}

// MARK: - ReconciliationResult
// Structured result from background reconciliation. Mirrors Swift's reconciled payload.
// Swift source: BoardStore.swift:218-247

export interface ReconciliationResult {
  links?: Record<string, Link>;
  sessions?: Record<string, Session>;
  activityMap?: Record<string, ActivityState>;
  tmuxSessions?: string[];
  configuredProjects?: Project[];
  excludedPaths?: string[];
  discoveredProjectPaths?: string[];
  globalRemoteSettings?: RemoteSettings | null;
}

// MARK: - UnlinkType

export type UnlinkType =
  | { kind: 'pr'; number: number }
  | { kind: 'issue' }
  | { kind: 'worktree' }
  | { kind: 'tmux' };

// MARK: - Action (all 51 from Swift)

export type Action =
  // UI actions
  | { type: 'createManualTask'; link: Link }
  | { type: 'selectCard'; cardId: string | null }
  | { type: 'moveCard'; cardId: string; column: KanbanCodeColumn }
  | { type: 'renameCard'; cardId: string; name: string }
  | { type: 'archiveCard'; cardId: string }
  | { type: 'deleteCard'; cardId: string }
  | { type: 'reorderCard'; cardId: string; targetCardId: string; above: boolean }
  | { type: 'updatePrompt'; cardId: string; body: string; imagePaths?: string[] | null }
  // Launch/resume
  | { type: 'launchCard'; cardId: string; prompt: string; projectPath: string; worktreeName?: string | null; runRemotely?: boolean; commandOverride?: string | null; skipPermissions?: boolean }
  | { type: 'resumeCard'; cardId: string }
  | { type: 'cancelLaunch'; cardId: string }
  | { type: 'launchCompleted'; cardId: string; tmuxName: string; sessionLink?: { sessionId: string; sessionPath?: string } | null; worktreeLink?: { path: string; branch?: string } | null; isRemote?: boolean }
  | { type: 'launchTmuxReady'; cardId: string }
  | { type: 'launchFailed'; cardId: string; error: string }
  | { type: 'resumeCompleted'; cardId: string; tmuxName: string; isRemote?: boolean }
  | { type: 'resumeFailed'; cardId: string; error: string }
  // Terminal
  | { type: 'createTerminal'; cardId: string }
  | { type: 'addExtraTerminal'; cardId: string; sessionName: string }
  | { type: 'terminalCreated'; cardId: string; tmuxName: string }
  | { type: 'terminalFailed'; cardId: string; error: string }
  | { type: 'extraTerminalCreated'; cardId: string; sessionName: string }
  | { type: 'killTerminal'; cardId: string; sessionName: string }
  | { type: 'renameTerminalTab'; cardId: string; sessionName: string; label: string }
  | { type: 'reorderTerminalTab'; cardId: string; sessionName: string; beforeSession: string | null }
  // Link management
  | { type: 'unlinkFromCard'; cardId: string; linkType: UnlinkType }
  | { type: 'addBranchToCard'; cardId: string; branch: string }
  | { type: 'addIssueLinkToCard'; cardId: string; issueNumber: number }
  | { type: 'addPRToCard'; cardId: string; prNumber: number }
  | { type: 'markPRMerged'; cardId: string; prNumber: number }
  // Queued prompts
  | { type: 'addQueuedPrompt'; cardId: string; prompt: QueuedPrompt }
  | { type: 'updateQueuedPrompt'; cardId: string; promptId: string; body: string; sendAutomatically: boolean }
  | { type: 'removeQueuedPrompt'; cardId: string; promptId: string }
  | { type: 'sendQueuedPrompt'; cardId: string; promptId: string }
  | { type: 'sendDirectPrompt'; cardId: string; body: string; imagePaths?: string[] }
  // Card organization
  | { type: 'moveCardToProject'; cardId: string; projectPath: string }
  | { type: 'moveCardToFolder'; cardId: string; folderPath: string; parentProjectPath: string }
  | { type: 'mergeCards'; sourceId: string; targetId: string }
  // Migration
  | { type: 'beginMigration'; cardId: string }
  | { type: 'migrateSession'; cardId: string; newAssistant: CodingAssistant; newSessionId: string; newSessionPath: string }
  | { type: 'migrationFailed'; cardId: string; error: string }
  // UI state
  | { type: 'setPaletteOpen'; open: boolean }
  | { type: 'setDetailExpanded'; expanded: boolean }
  | { type: 'setSelectedProject'; path: string | null }
  // Settings
  | { type: 'setError'; message: string | null }
  | { type: 'setLoading'; isLoading: boolean }
  | { type: 'setBusy'; cardId: string; busy: boolean }
  | { type: 'setRateLimitedRepos'; repos: string[] }
  | { type: 'setIsRefreshingBacklog'; refreshing: boolean }
  | { type: 'settingsLoaded'; projects: Project[]; excludedPaths: string[]; remote: RemoteSettings | null }
  // Background
  | { type: 'reconciled'; result: ReconciliationResult }
  | { type: 'activityChanged'; activityMap: Record<string, ActivityState> }
  | { type: 'gitHubIssuesUpdated'; links: Link[] }
  | { type: 'loadDeletedIds'; sessionIds: string[]; cardIds: string[] }
  | { type: 'bulkArchive'; cardIds: string[] }
  | { type: 'bulkResume'; cardIds: string[] }
  | { type: 'bulkMoveToProject'; cardIds: string[]; projectPath: string }
  | { type: 'bulkDelete'; cardIds: string[] };

// MARK: - Effect

export type Effect =
  | { type: 'persistLinks'; links: Record<string, Link> }
  | { type: 'upsertLink'; link: Link }
  | { type: 'removeLink'; id: string }
  | { type: 'createTmuxSession'; cardId: string; name: string; path: string; command?: string }
  | { type: 'killTmuxSession'; name: string }
  | { type: 'killTmuxSessions'; names: string[] }
  | { type: 'deleteSessionFile'; path: string }
  | { type: 'cleanupTerminalCache'; sessionNames: string[] }
  | { type: 'updateSessionIndex'; sessionId: string; name: string }
  | { type: 'moveSessionFile'; cardId: string; sessionId: string; oldPath: string; newProjectPath: string }
  | { type: 'sendPromptToTmux'; sessionName: string; promptBody: string; assistant: CodingAssistant }
  | { type: 'sendPromptWithImagesToTmux'; sessionName: string; promptBody: string; imagePaths: string[]; assistant: CodingAssistant }
  | { type: 'deleteFiles'; paths: string[] }
  | { type: 'persistDeletedIds'; sessionIds: string[]; cardIds: string[] };

// MARK: - Reducer

export function reduce(state: AppState, action: Action): { state: AppState; effects: Effect[] } {
  const newState = { ...state };
  const effects: Effect[] = [];

  switch (action.type) {
    case 'createManualTask': {
      newState.links = { ...state.links, [action.link.id]: action.link };
      effects.push({ type: 'upsertLink', link: action.link });
      break;
    }

    case 'selectCard': {
      newState.selectedCardId = action.cardId;
      if (action.cardId && state.links[action.cardId]) {
        const link = { ...state.links[action.cardId], lastOpenedAt: new Date().toISOString() };
        newState.links = { ...state.links, [action.cardId]: link };
        effects.push({ type: 'upsertLink', link });
      }
      break;
    }

    case 'moveCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated: Link = {
        ...link,
        column: action.column,
        manualOverrides: { ...link.manualOverrides, column: true },
        manuallyArchived: action.column === 'all_sessions',
        updatedAt: new Date().toISOString(),
        sortOrder: null,
      };
      // If un-archiving, clear manuallyArchived
      if (action.column !== 'all_sessions' && link.manuallyArchived) {
        updated.manuallyArchived = false;
      }
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'renameCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated: Link = {
        ...link,
        name: action.name,
        manualOverrides: { ...link.manualOverrides, name: true },
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      if (link.sessionLink?.sessionId) {
        effects.push({ type: 'updateSessionIndex', sessionId: link.sessionLink.sessionId, name: action.name });
      }
      break;
    }

    case 'updatePrompt': {
      const link = state.links[action.cardId];
      if (!link) break;
      const oldImages = link.promptImagePaths ?? [];
      const newImageSet = new Set(action.imagePaths ?? []);
      const removedImages = oldImages.filter(p => !newImageSet.has(p));
      const updated: Link = {
        ...link,
        promptBody: action.body,
        promptImagePaths: action.imagePaths ?? null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      if (removedImages.length > 0) {
        effects.push({ type: 'deleteFiles', paths: removedImages });
      }
      break;
    }

    case 'archiveCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const tmuxNames = link.tmuxLink ? [link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? [])] : [];
      const updated: Link = {
        ...link,
        column: 'all_sessions',
        manuallyArchived: true,
        tmuxLink: null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      if (tmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: tmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: tmuxNames });
      }
      break;
    }

    case 'deleteCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const { [action.cardId]: _, ...remaining } = state.links;
      newState.links = remaining;
      newState.deletedCardIds = [...state.deletedCardIds, action.cardId];
      if (link.sessionLink?.sessionId) {
        newState.deletedSessionIds = [...state.deletedSessionIds, link.sessionLink.sessionId];
      }
      if (newState.selectedCardId === action.cardId) {
        newState.selectedCardId = null;
      }
      effects.push({ type: 'removeLink', id: action.cardId });
      const tmuxNames = link.tmuxLink ? [link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? [])] : [];
      if (tmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: tmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: tmuxNames });
      }
      if (link.sessionLink?.sessionPath) {
        effects.push({ type: 'deleteSessionFile', path: link.sessionLink.sessionPath });
      }
      // Clean up prompt and queued prompt images
      const imagesToDelete = [
        ...(link.promptImagePaths ?? []),
        ...(link.queuedPrompts ?? []).flatMap(p => p.imagePaths ?? []),
      ];
      if (imagesToDelete.length > 0) {
        effects.push({ type: 'deleteFiles', paths: imagesToDelete });
      }
      effects.push({ type: 'persistDeletedIds', sessionIds: newState.deletedSessionIds, cardIds: newState.deletedCardIds });
      break;
    }

    case 'launchCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const projectName = (action.projectPath.split('/').filter(Boolean).pop() ?? 'project').replace(/\s+/g, '-');
      const effectiveName = action.worktreeName && action.worktreeName.length > 0 ? action.worktreeName : null;
      const tmuxName = effectiveName
        ? `${projectName}-${effectiveName}`
        : `${projectName}-${action.cardId}`;
      // Preserve existing shell sessions as extras
      let extras = [...(link.tmuxLink?.extraSessions ?? [])];
      if (link.tmuxLink?.isShellOnly && link.tmuxLink.sessionName) {
        extras.unshift(link.tmuxLink.sessionName);
      }
      const updated: Link = {
        ...link,
        column: 'in_progress',
        isLaunching: true,
        tmuxLink: { sessionName: tmuxName, extraSessions: extras.length > 0 ? extras : null },
        projectPath: action.projectPath,
        manualOverrides: { ...link.manualOverrides, column: false },
        updatedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.selectedCardId = action.cardId;
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'resumeCard': {
      const link = state.links[action.cardId];
      if (!link?.sessionLink) break;
      const sid = link.sessionLink.sessionId ?? link.id;
      const assistant = getEffectiveAssistant(link);
      const tmuxName = `${assistant}-${sid.substring(0, 8)}`;
      // Preserve existing shell sessions as extras
      let extras = [...(link.tmuxLink?.extraSessions ?? [])];
      if (link.tmuxLink?.isShellOnly && link.tmuxLink.sessionName) {
        extras.unshift(link.tmuxLink.sessionName);
      }
      const updated: Link = {
        ...link,
        column: 'in_progress',
        isLaunching: true,
        tmuxLink: { sessionName: tmuxName, extraSessions: extras.length > 0 ? extras : null },
        manualOverrides: { ...link.manualOverrides, column: false },
        manuallyArchived: false,
        updatedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.selectedCardId = action.cardId;
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'launchCompleted': {
      const link = state.links[action.cardId];
      if (!link) break;
      const existingExtras = link.tmuxLink?.extraSessions ?? null;
      const updated: Link = {
        ...link,
        column: 'in_progress',
        isLaunching: null,
        tmuxLink: { sessionName: action.tmuxName, extraSessions: existingExtras },
        sessionLink: action.sessionLink ?? link.sessionLink,
        worktreeLink: action.worktreeLink ?? link.worktreeLink,
        isRemote: action.isRemote ?? link.isRemote,
        manualOverrides: { ...link.manualOverrides, column: false },
        lastActivity: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      // Update activityMap so the reconciler doesn't immediately override back
      newState.activityMap = { ...state.activityMap };
      if (link.sessionLink?.sessionId) {
        newState.activityMap[link.sessionLink.sessionId] = 'idle_waiting';
      }
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'launchTmuxReady': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated: Link = {
        ...link,
        isLaunching: null,
        lastActivity: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'launchFailed': {
      const link = state.links[action.cardId];
      if (!link) break;
      // launchFailed does NOT kill tmux (cleanup deferred) -- spec Section 7.8
      const updated: Link = { ...link, isLaunching: null, tmuxLink: null, updatedAt: new Date().toISOString() };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.error = action.error;
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'resumeCompleted': {
      const link = state.links[action.cardId];
      if (!link) break;
      const existingExtras = link.tmuxLink?.extraSessions ?? null;
      const updated: Link = {
        ...link,
        column: 'in_progress',
        isLaunching: null,
        tmuxLink: { sessionName: action.tmuxName, extraSessions: existingExtras },
        isRemote: action.isRemote ?? link.isRemote,
        manualOverrides: { ...link.manualOverrides, column: false },
        lastActivity: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      // Update activityMap so the reconciler doesn't immediately override back
      newState.activityMap = { ...state.activityMap };
      if (link.sessionLink?.sessionId) {
        newState.activityMap[link.sessionLink.sessionId] = 'idle_waiting';
      }
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'resumeFailed': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated: Link = { ...link, isLaunching: null, tmuxLink: null, updatedAt: new Date().toISOString() };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.error = action.error;
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'createTerminal': {
      const link = state.links[action.cardId];
      if (!link) break;
      const projectName = link.projectPath?.split('/').filter(Boolean).pop() ?? 'shell';
      const tmuxName = `${projectName}-${link.id}`;
      const workDir = (link.worktreeLink?.path && link.worktreeLink.path.length > 0)
        ? link.worktreeLink.path
        : (link.projectPath ?? process.env.HOME ?? '/tmp');
      const updated: Link = {
        ...link,
        tmuxLink: { sessionName: tmuxName, isShellOnly: true },
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.busyCards = [...state.busyCards, action.cardId];
      effects.push({ type: 'createTmuxSession', cardId: action.cardId, name: tmuxName, path: workDir });
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'addExtraTerminal': {
      const link = state.links[action.cardId];
      if (!link?.tmuxLink) break;
      const workDir = (link.worktreeLink?.path && link.worktreeLink.path.length > 0)
        ? link.worktreeLink.path
        : (link.projectPath ?? process.env.HOME ?? '/tmp');
      const extras = [...(link.tmuxLink.extraSessions ?? []), action.sessionName];
      const updated: Link = {
        ...link,
        tmuxLink: { ...link.tmuxLink, extraSessions: extras },
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.busyCards = [...state.busyCards, action.cardId];
      effects.push({ type: 'createTmuxSession', cardId: action.cardId, name: action.sessionName, path: workDir });
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'terminalCreated': {
      newState.busyCards = state.busyCards.filter(id => id !== action.cardId);
      break;
    }

    case 'terminalFailed': {
      const link = state.links[action.cardId];
      if (link) {
        const updated: Link = { ...link, tmuxLink: null, updatedAt: new Date().toISOString() };
        newState.links = { ...state.links, [action.cardId]: updated };
        effects.push({ type: 'upsertLink', link: updated });
      }
      newState.busyCards = state.busyCards.filter(id => id !== action.cardId);
      newState.error = action.error;
      break;
    }

    case 'extraTerminalCreated': {
      newState.busyCards = state.busyCards.filter(id => id !== action.cardId);
      break;
    }

    case 'renameTerminalTab': {
      const link = state.links[action.cardId];
      if (!link?.tmuxLink) break;
      const tabNames = { ...(link.tmuxLink.tabNames ?? {}) };
      if (action.label.length === 0) {
        delete tabNames[action.sessionName];
      } else {
        tabNames[action.sessionName] = action.label;
      }
      const hasTabNames = Object.keys(tabNames).length > 0;
      const updated: Link = {
        ...link,
        tmuxLink: { ...link.tmuxLink, tabNames: hasTabNames ? tabNames : null },
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'reorderTerminalTab': {
      const link = state.links[action.cardId];
      if (!link?.tmuxLink?.extraSessions) break;
      const extras = [...link.tmuxLink.extraSessions];
      const fromIndex = extras.indexOf(action.sessionName);
      if (fromIndex === -1) break;
      extras.splice(fromIndex, 1);
      if (action.beforeSession) {
        const toIndex = extras.indexOf(action.beforeSession);
        if (toIndex !== -1) {
          extras.splice(toIndex, 0, action.sessionName);
        } else {
          extras.push(action.sessionName);
        }
      } else {
        extras.push(action.sessionName);
      }
      const updated: Link = {
        ...link,
        tmuxLink: { ...link.tmuxLink, extraSessions: extras },
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'killTerminal': {
      const link = state.links[action.cardId];
      if (!link?.tmuxLink) break;
      const tmux = link.tmuxLink;
      let updatedTmux = tmux;

      if (action.sessionName === tmux.sessionName) {
        // Killing primary
        const extras = tmux.extraSessions ?? [];
        if (extras.length > 0) {
          updatedTmux = { ...tmux, isPrimaryDead: true };
        } else {
          // No extras left -- clear tmuxLink entirely
          const updated: Link = { ...link, tmuxLink: null, updatedAt: new Date().toISOString() };
          newState.links = { ...state.links, [action.cardId]: updated };
          effects.push({ type: 'killTmuxSession', name: action.sessionName });
          effects.push({ type: 'cleanupTerminalCache', sessionNames: [action.sessionName] });
          effects.push({ type: 'upsertLink', link: updated });
          break;
        }
      } else {
        // Killing an extra
        const newExtras = (tmux.extraSessions ?? []).filter(s => s !== action.sessionName);
        if (newExtras.length === 0 && tmux.isPrimaryDead) {
          // Last extra killed while primary dead -- clear tmuxLink
          const updated: Link = { ...link, tmuxLink: null, updatedAt: new Date().toISOString() };
          newState.links = { ...state.links, [action.cardId]: updated };
          effects.push({ type: 'killTmuxSession', name: action.sessionName });
          effects.push({ type: 'cleanupTerminalCache', sessionNames: [action.sessionName] });
          effects.push({ type: 'upsertLink', link: updated });
          break;
        }
        updatedTmux = { ...tmux, extraSessions: newExtras.length > 0 ? newExtras : null };
      }

      const updated: Link = { ...link, tmuxLink: updatedTmux, updatedAt: new Date().toISOString() };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'killTmuxSession', name: action.sessionName });
      effects.push({ type: 'cleanupTerminalCache', sessionNames: [action.sessionName] });
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'cancelLaunch': {
      const link = state.links[action.cardId];
      if (!link) break;
      const tmuxName = link.tmuxLink?.sessionName;
      const updated: Link = { ...link, isLaunching: null, tmuxLink: null };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      if (tmuxName) {
        effects.push({ type: 'killTmuxSession', name: tmuxName });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: [tmuxName] });
      }
      break;
    }

    case 'reorderCard': {
      // Recompute sortOrder for all cards in the column
      const link = state.links[action.cardId];
      const target = state.links[action.targetCardId];
      if (!link || !target || link.column !== target.column) break;

      const columnCards = Object.values(state.links)
        .filter(l => l.column === link.column)
        .sort((a, b) => (a.sortOrder ?? 999999) - (b.sortOrder ?? 999999));

      // Remove the card being moved
      const withoutMoving = columnCards.filter(c => c.id !== action.cardId);
      // Find target position
      const targetIdx = withoutMoving.findIndex(c => c.id === action.targetCardId);
      const insertIdx = action.above ? targetIdx : targetIdx + 1;
      // Insert at position
      withoutMoving.splice(insertIdx, 0, link);

      // Assign sort orders
      const updatedLinks = { ...state.links };
      withoutMoving.forEach((card, idx) => {
        updatedLinks[card.id] = { ...card, sortOrder: idx, updatedAt: new Date().toISOString() };
        effects.push({ type: 'upsertLink', link: updatedLinks[card.id] });
      });
      newState.links = updatedLinks;
      break;
    }

    // MARK: Link Management

    case 'unlinkFromCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated = { ...link };
      const linkType = action.linkType;
      switch (linkType.kind) {
        case 'pr': {
          updated.prLinks = link.prLinks.filter(pr => pr.number !== linkType.number);
          const dismissed = [...(link.manualOverrides.dismissedPRs ?? [])];
          if (!dismissed.includes(linkType.number)) {
            dismissed.push(linkType.number);
          }
          updated.manualOverrides = { ...link.manualOverrides, dismissedPRs: dismissed };
          break;
        }
        case 'issue':
          updated.issueLink = null;
          updated.manualOverrides = { ...link.manualOverrides, issueLink: true };
          break;
        case 'worktree': {
          // Set watermark to current session file size (data before this is ignored)
          // Swift: BoardStore.swift:490-493
          let watermark = 0;
          if (link.sessionLink?.sessionPath) {
            try { watermark = fs.statSync(link.sessionLink.sessionPath).size; } catch { /* file may not exist */ }
          }
          updated.manualOverrides = { ...link.manualOverrides, branchWatermark: watermark };
          updated.discoveredBranches = null;
          updated.worktreeLink = null;
          break;
        }
        case 'tmux':
          updated.tmuxLink = null;
          updated.manualOverrides = { ...link.manualOverrides, tmuxSession: true };
          break;
      }
      updated.updatedAt = new Date().toISOString();
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'addBranchToCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const worktreeLink = link.worktreeLink
        ? { ...link.worktreeLink, branch: action.branch }
        : { path: '', branch: action.branch };
      const updated: Link = {
        ...link,
        worktreeLink,
        manualOverrides: { ...link.manualOverrides, worktreePath: true },
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'addIssueLinkToCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated: Link = {
        ...link,
        issueLink: { number: action.issueNumber },
        manualOverrides: { ...link.manualOverrides, issueLink: true },
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'addPRToCard': {
      const link = state.links[action.cardId];
      if (!link) break;
      const prLinks = [...link.prLinks];
      if (!prLinks.some(pr => pr.number === action.prNumber)) {
        prLinks.push({ number: action.prNumber });
      }
      // Un-dismiss if it was previously dismissed
      let dismissedPRs = [...(link.manualOverrides.dismissedPRs ?? [])];
      dismissedPRs = dismissedPRs.filter(n => n !== action.prNumber);
      const updated: Link = {
        ...link,
        prLinks,
        manualOverrides: {
          ...link.manualOverrides,
          dismissedPRs: dismissedPRs.length > 0 ? dismissedPRs : null,
          prLink: false,
        },
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'markPRMerged': {
      const link = state.links[action.cardId];
      if (!link) break;
      const prLinks = link.prLinks.map(pr =>
        pr.number === action.prNumber ? { ...pr, status: 'merged' as const } : pr
      );
      const updated: Link = {
        ...link,
        prLinks,
        column: 'done',
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    // MARK: Queued Prompts

    case 'addQueuedPrompt': {
      const link = state.links[action.cardId];
      if (!link) break;
      const prompts = [...(link.queuedPrompts ?? []), action.prompt];
      const updated: Link = {
        ...link,
        queuedPrompts: prompts,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'updateQueuedPrompt': {
      const link = state.links[action.cardId];
      if (!link?.queuedPrompts) break;
      const idx = link.queuedPrompts.findIndex(p => p.id === action.promptId);
      if (idx === -1) break;
      const prompts = [...link.queuedPrompts];
      prompts[idx] = { ...prompts[idx], body: action.body, sendAutomatically: action.sendAutomatically };
      const updated: Link = {
        ...link,
        queuedPrompts: prompts,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'removeQueuedPrompt': {
      const link = state.links[action.cardId];
      if (!link?.queuedPrompts) break;
      const prompts = link.queuedPrompts.filter(p => p.id !== action.promptId);
      const updated: Link = {
        ...link,
        queuedPrompts: prompts.length > 0 ? prompts : null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      break;
    }

    case 'sendDirectPrompt': {
      const link = state.links[action.cardId];
      if (!link?.tmuxLink) break;
      const sessionName = getTmuxAllSessionNames(link.tmuxLink)[0];
      if (!sessionName) break;
      const assistant = getEffectiveAssistant(link);
      if (action.imagePaths?.length) {
        effects.push({ type: 'sendPromptWithImagesToTmux', sessionName, promptBody: action.body, imagePaths: action.imagePaths, assistant });
      } else {
        effects.push({ type: 'sendPromptToTmux', sessionName, promptBody: action.body, assistant });
      }
      break;
    }

    case 'sendQueuedPrompt': {
      const link = state.links[action.cardId];
      if (!link?.queuedPrompts || !link.tmuxLink?.sessionName) break;
      const prompt = link.queuedPrompts.find(p => p.id === action.promptId);
      if (!prompt) break;
      const sessionName = link.tmuxLink.sessionName;
      const prompts = link.queuedPrompts.filter(p => p.id !== action.promptId);
      const updated: Link = {
        ...link,
        queuedPrompts: prompts.length > 0 ? prompts : null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      const assistant = getEffectiveAssistant(link);
      if (prompt.imagePaths && prompt.imagePaths.length > 0 && getSupportsImageUpload(assistant)) {
        effects.push({
          type: 'sendPromptWithImagesToTmux',
          sessionName,
          promptBody: prompt.body,
          imagePaths: prompt.imagePaths,
          assistant,
        });
      } else {
        effects.push({
          type: 'sendPromptToTmux',
          sessionName,
          promptBody: prompt.body,
          assistant,
        });
      }
      break;
    }

    // MARK: Card Organization

    case 'moveCardToProject': {
      const link = state.links[action.cardId];
      if (!link) break;
      const oldProjectPath = link.projectPath;
      const tmuxNames = link.tmuxLink ? [link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? [])] : [];
      const updated: Link = {
        ...link,
        projectPath: action.projectPath,
        worktreeLink: null,
        prLinks: [],
        discoveredBranches: null,
        discoveredRepos: null,
        tmuxLink: null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      if (tmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: tmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: tmuxNames });
      }
      if (link.sessionLink?.sessionId && link.sessionLink?.sessionPath && oldProjectPath !== action.projectPath) {
        effects.push({
          type: 'moveSessionFile',
          cardId: action.cardId,
          sessionId: link.sessionLink.sessionId,
          oldPath: link.sessionLink.sessionPath,
          newProjectPath: action.projectPath,
        });
      }
      break;
    }

    case 'moveCardToFolder': {
      const link = state.links[action.cardId];
      if (!link) break;
      const oldProjectPath = link.projectPath;
      const tmuxNames = link.tmuxLink ? [link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? [])] : [];
      const shouldClearRepoLinks = oldProjectPath !== action.parentProjectPath;
      const updated: Link = {
        ...link,
        projectPath: action.parentProjectPath,
        worktreeLink: shouldClearRepoLinks ? null : link.worktreeLink,
        prLinks: shouldClearRepoLinks ? [] : link.prLinks,
        discoveredBranches: shouldClearRepoLinks ? null : link.discoveredBranches,
        discoveredRepos: shouldClearRepoLinks ? null : link.discoveredRepos,
        tmuxLink: null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      effects.push({ type: 'upsertLink', link: updated });
      if (tmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: tmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: tmuxNames });
      }
      if (link.sessionLink?.sessionId && link.sessionLink?.sessionPath) {
        effects.push({
          type: 'moveSessionFile',
          cardId: action.cardId,
          sessionId: link.sessionLink.sessionId,
          oldPath: link.sessionLink.sessionPath,
          newProjectPath: action.folderPath,
        });
      }
      break;
    }

    case 'mergeCards': {
      const source = state.links[action.sourceId];
      const target = state.links[action.targetId];
      if (!source || !target || action.sourceId === action.targetId) break;

      // Validate using mergeBlocked
      const blocked = mergeBlocked(source, target);
      if (blocked) {
        newState.error = blocked;
        break;
      }

      // Transfer links from source -> target (only fill null slots)
      const merged: Link = { ...target };
      if (!merged.sessionLink) merged.sessionLink = source.sessionLink;
      if (!merged.tmuxLink) merged.tmuxLink = source.tmuxLink;
      if (!merged.worktreeLink) merged.worktreeLink = source.worktreeLink;
      if (!merged.issueLink) merged.issueLink = source.issueLink;
      if (!merged.projectPath) merged.projectPath = source.projectPath;
      if (!merged.name) merged.name = source.name;
      if (!merged.promptBody) merged.promptBody = source.promptBody;
      // Merge PR links (deduplicate by PR number)
      const existingPRNumbers = new Set(merged.prLinks.map(pr => pr.number));
      for (const pr of source.prLinks) {
        if (!existingPRNumbers.has(pr.number)) {
          merged.prLinks = [...merged.prLinks, pr];
        }
      }
      // Merge discovered branches
      if (source.discoveredBranches) {
        const branches = [...(merged.discoveredBranches ?? [])];
        for (const b of source.discoveredBranches) {
          if (!branches.includes(b)) branches.push(b);
        }
        merged.discoveredBranches = branches;
      }
      if (source.discoveredRepos) {
        merged.discoveredRepos = { ...(merged.discoveredRepos ?? {}), ...source.discoveredRepos };
      }
      // Preserve the more recent lastActivity
      if (source.lastActivity) {
        if (!merged.lastActivity || source.lastActivity > merged.lastActivity) {
          merged.lastActivity = source.lastActivity;
        }
      }
      // If source is remote, inherit that
      if (source.isRemote) merged.isRemote = true;

      merged.updatedAt = new Date().toISOString();

      // Remove source card
      const { [action.sourceId]: _removedSource, ...remainingLinks } = state.links;
      remainingLinks[action.targetId] = merged;
      newState.links = remainingLinks;
      newState.deletedCardIds = [...state.deletedCardIds, action.sourceId];
      if (source.sessionLink?.sessionId && merged.sessionLink?.sessionId !== source.sessionLink.sessionId) {
        newState.deletedSessionIds = [...state.deletedSessionIds, source.sessionLink.sessionId];
      }
      if (state.selectedCardId === action.sourceId) {
        newState.selectedCardId = action.targetId;
      }
      effects.push({ type: 'upsertLink', link: merged });
      effects.push({ type: 'removeLink', id: action.sourceId });
      effects.push({ type: 'persistDeletedIds', sessionIds: newState.deletedSessionIds, cardIds: newState.deletedCardIds });
      break;
    }

    // MARK: Migration

    case 'beginMigration': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated: Link = {
        ...link,
        isLaunching: true,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.busyCards = [...state.busyCards, action.cardId];
      break;
    }

    case 'migrateSession': {
      const link = state.links[action.cardId];
      if (!link) break;
      // Mark old session as deleted so reconciler won't recreate a card for it
      if (link.sessionLink?.sessionId) {
        newState.deletedSessionIds = [...state.deletedSessionIds, link.sessionLink.sessionId];
      }
      const tmuxNames = link.tmuxLink ? [link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? [])] : [];
      const updated: Link = {
        ...link,
        assistant: action.newAssistant,
        sessionLink: { sessionId: action.newSessionId, sessionPath: action.newSessionPath },
        tmuxLink: null,
        isLaunching: null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.busyCards = state.busyCards.filter(id => id !== action.cardId);
      effects.push({ type: 'upsertLink', link: updated });
      if (tmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: tmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: tmuxNames });
      }
      effects.push({ type: 'persistDeletedIds', sessionIds: newState.deletedSessionIds, cardIds: newState.deletedCardIds });
      break;
    }

    case 'migrationFailed': {
      const link = state.links[action.cardId];
      if (!link) break;
      const updated: Link = {
        ...link,
        isLaunching: null,
        updatedAt: new Date().toISOString(),
      };
      newState.links = { ...state.links, [action.cardId]: updated };
      newState.busyCards = state.busyCards.filter(id => id !== action.cardId);
      newState.error = `Migration failed: ${action.error}`;
      break;
    }

    // MARK: UI State

    case 'setPaletteOpen': {
      newState.paletteOpen = action.open;
      break;
    }

    case 'setDetailExpanded': {
      newState.detailExpanded = action.expanded;
      break;
    }

    case 'setSelectedProject': {
      newState.selectedProjectPath = action.path;
      break;
    }

    // MARK: Settings / Misc

    case 'setError': {
      newState.error = action.message;
      break;
    }

    case 'setLoading': {
      newState.isLoading = action.isLoading;
      break;
    }

    case 'setBusy': {
      if (action.busy) {
        newState.busyCards = [...state.busyCards, action.cardId];
      } else {
        newState.busyCards = state.busyCards.filter(id => id !== action.cardId);
      }
      break;
    }

    case 'setRateLimitedRepos': {
      newState.rateLimitedRepos = action.repos;
      break;
    }

    case 'setIsRefreshingBacklog': {
      newState.isRefreshingBacklog = action.refreshing;
      break;
    }

    case 'settingsLoaded': {
      newState.configuredProjects = action.projects;
      newState.excludedPaths = action.excludedPaths;
      newState.globalRemoteSettings = action.remote;
      break;
    }

    // MARK: Background Reconciliation

    case 'reconciled': {
      // Merge non-link fields directly
      if (action.result.sessions) newState.sessions = action.result.sessions;
      if (action.result.activityMap) newState.activityMap = action.result.activityMap;
      if (action.result.tmuxSessions) newState.tmuxSessions = action.result.tmuxSessions;
      if (action.result.configuredProjects) newState.configuredProjects = action.result.configuredProjects;
      if (action.result.excludedPaths) newState.excludedPaths = action.result.excludedPaths;
      if (action.result.discoveredProjectPaths) newState.discoveredProjectPaths = action.result.discoveredProjectPaths;
      if (action.result.globalRemoteSettings !== undefined) newState.globalRemoteSettings = action.result.globalRemoteSettings;

      // Merge reconciled links: isLaunching guard + last-writer-wins + deleted skip
      // Swift source: BoardStore.swift:944-1075
      if (action.result.links) {
        const reconciledLinks = action.result.links;
        const reconciledActivity = action.result.activityMap ?? state.activityMap;
        const mergedLinks: Record<string, Link> = { ...state.links };
        const now = Date.now();
        const STALE_LAUNCH_TIMEOUT_MS = 30_000; // spec Section 7.6: launchStaleTimeout

        for (const [id, link] of Object.entries(reconciledLinks)) {
          // Skip cards deliberately deleted during this reconciliation cycle
          if (state.deletedCardIds.includes(id)) continue;
          // Skip cards whose session was deliberately deleted
          const sessionId = link.sessionLink?.sessionId;
          if (sessionId && state.deletedSessionIds.includes(sessionId)) continue;

          const existing = mergedLinks[id];
          if (existing) {
            if (existing.isLaunching === true) {
              // If reconciler discovered a sessionLink the card doesn't have yet,
              // attach it. This handles Kiro (and any assistant) where the session ID
              // isn't known at launch time but is discovered from disk/SQLite.
              const attachSession = !existing.sessionLink && link.sessionLink;
              const merged = attachSession
                ? { ...existing, sessionLink: link.sessionLink }
                : existing;
              // Check if activity hook has confirmed the session is running
              const activity = reconciledActivity[merged.sessionLink?.sessionId ?? ''];
              if (activity != null) {
                // Activity detected -- clear isLaunching
                mergedLinks[id] = { ...merged, isLaunching: null };
                continue;
              }
              // Stale launch timeout: clear isLaunching after 30s (crash recovery)
              if (now - new Date(existing.updatedAt).getTime() > STALE_LAUNCH_TIMEOUT_MS) {
                mergedLinks[id] = { ...link, isLaunching: null };
                continue;
              }
              // Still launching but session discovered -- attach it even if no activity yet
              if (attachSession) {
                mergedLinks[id] = merged;
                continue;
              }
              // Still launching, no activity yet -- preserve in-memory state
              continue;
            }
            // Last-writer-wins: in-memory state is newer -> preserve it
            if (new Date(existing.updatedAt).getTime() > new Date(link.updatedAt).getTime()) {
              continue;
            }
          }
          mergedLinks[id] = link;
        }

        // Orphan worktree dedup: absorb orphan cards into session cards on same branch
        // Swift source: BoardStore.swift:997-1032
        const branchToIds: Record<string, string[]> = {};
        for (const [id, link] of Object.entries(mergedLinks)) {
          const branch = link.worktreeLink?.branch;
          if (branch) {
            if (!branchToIds[branch]) branchToIds[branch] = [];
            branchToIds[branch].push(id);
          }
        }
        for (const [, ids] of Object.entries(branchToIds)) {
          if (ids.length <= 1) continue;
          const realIds = ids.filter(id => {
            const l = mergedLinks[id];
            return l.sessionLink != null || l.source === 'manual' || l.name != null;
          });
          const orphanIds = ids.filter(id => {
            const l = mergedLinks[id];
            return l.sessionLink == null && l.source !== 'manual' && l.name == null;
          });
          if (orphanIds.length === 0) continue;
          const keeperId = realIds[0] ?? orphanIds[0];
          const keeper = { ...mergedLinks[keeperId] };
          for (const orphanId of orphanIds) {
            if (orphanId === keeperId) continue;
            const orphan = mergedLinks[orphanId];
            if (keeper.worktreeLink == null) keeper.worktreeLink = orphan.worktreeLink;
            if (keeper.tmuxLink == null) keeper.tmuxLink = orphan.tmuxLink;
            delete mergedLinks[orphanId];
          }
          mergedLinks[keeperId] = keeper;
        }

        // Recompute columns for cards NOT mid-launch
        // Swift source: BoardStore.swift:1034-1073
        const activityForColumns = action.result.activityMap ?? state.activityMap;
        const liveTmux = new Set(action.result.tmuxSessions ?? state.tmuxSessions);
        const sessionsForPrompt = action.result.sessions ?? state.sessions;

        for (const [id, link] of Object.entries(mergedLinks)) {
          if (link.isLaunching === true) continue;
          // Archived cards stay archived — only explicit user actions (resumeCard, moveCard) un-archive.
          // Background reconciliation must never override the user's archive decision.
          if (link.manuallyArchived) continue;

          // Ensure required fields exist (links from test fixtures or old data may lack defaults)
          let updated = {
            ...link,
            prLinks: link.prLinks ?? [],
            manualOverrides: link.manualOverrides ?? { worktreePath: false, tmuxSession: false, name: false, column: false, prLink: false, issueLink: false },
          };
          const activity = activityForColumns[link.sessionLink?.sessionId ?? ''] ?? null;

          // Check if tmux session is live (shell-only doesn't count)
          const hasTmux = (() => {
            if (!updated.tmuxLink || updated.tmuxLink.isShellOnly) return false;
            const allNames = [updated.tmuxLink.sessionName, ...(updated.tmuxLink.extraSessions ?? [])];
            return allNames.some(n => liveTmux.has(n));
          })();
          const hasWorktree = updated.worktreeLink?.branch != null;

          // Clear manual column override when we have definitive data
          // Backlog is sticky — user explicitly parked this card
          if (updated.manualOverrides?.column && updated.column !== 'backlog') {
            if (activity != null && activity !== 'stale') {
              updated.manualOverrides = { ...updated.manualOverrides, column: false };
            } else if (updated.tmuxLink && !hasTmux) {
              updated.tmuxLink = null;
              updated.manualOverrides = { ...updated.manualOverrides, column: false };
            }
          }

          updated = updateCardColumn(updated, activity, hasWorktree || hasTmux);

          // Copy session's firstPrompt into link.promptBody
          if (!updated.promptBody && updated.sessionLink?.sessionId) {
            const session = sessionsForPrompt[updated.sessionLink.sessionId];
            if (session?.firstPrompt) {
              updated.promptBody = session.firstPrompt;
            }
          }

          mergedLinks[id] = updated;
        }

        newState.links = mergedLinks;
      }

      // Validate selected card still exists
      if (newState.selectedCardId && !newState.links[newState.selectedCardId]) {
        newState.selectedCardId = null;
      }

      newState.isLoading = false;
      newState.lastRefresh = new Date().toISOString();
      effects.push({ type: 'persistLinks', links: newState.links });
      break;
    }

    case 'activityChanged': {
      newState.activityMap = { ...state.activityMap, ...action.activityMap };
      break;
    }

    case 'gitHubIssuesUpdated': {
      const updatedIds = new Set(action.links.map(l => l.id));
      const mergedLinks = { ...state.links };
      for (const link of action.links) {
        // Don't overwrite cards modified since the GitHub refresh started
        const existing = mergedLinks[link.id];
        if (existing && new Date(existing.updatedAt).getTime() > new Date(link.updatedAt).getTime()) {
          continue;
        }
        mergedLinks[link.id] = link;
      }
      // Remove stale GitHub issues no longer in the fetched set
      // Only remove orphan issues (no session attached) — Swift: BoardStore.swift:1098
      for (const [id, link] of Object.entries(mergedLinks)) {
        if (link.source === 'github_issue' && link.column === 'backlog' && !link.sessionLink && !updatedIds.has(id)) {
          delete mergedLinks[id];
        }
      }
      newState.links = mergedLinks;
      newState.lastGitHubRefresh = new Date().toISOString();
      effects.push({ type: 'persistLinks', links: newState.links });
      break;
    }

    case 'bulkArchive': {
      const allTmuxNames: string[] = [];
      const updatedLinks = { ...state.links };
      for (const cardId of action.cardIds) {
        const link = updatedLinks[cardId];
        if (!link) continue;
        if (link.tmuxLink) {
          allTmuxNames.push(link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? []));
        }
        updatedLinks[cardId] = {
          ...link,
          column: 'all_sessions',
          manuallyArchived: true,
          tmuxLink: null,
          updatedAt: new Date().toISOString(),
        };
      }
      newState.links = updatedLinks;
      effects.push({ type: 'persistLinks', links: updatedLinks });
      if (allTmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: allTmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: allTmuxNames });
      }
      break;
    }

    case 'bulkResume': {
      const updatedLinks = { ...state.links };
      for (const cardId of action.cardIds) {
        const link = updatedLinks[cardId];
        if (!link?.sessionLink) continue;
        const sid = link.sessionLink.sessionId ?? link.id;
        const assistant = getEffectiveAssistant(link);
        const tmuxName = `${assistant}-${sid.substring(0, 8)}`;
        let extras = [...(link.tmuxLink?.extraSessions ?? [])];
        if (link.tmuxLink?.isShellOnly && link.tmuxLink.sessionName) {
          extras.unshift(link.tmuxLink.sessionName);
        }
        updatedLinks[cardId] = {
          ...link,
          column: 'in_progress',
          isLaunching: true,
          tmuxLink: { sessionName: tmuxName, extraSessions: extras.length > 0 ? extras : null },
          manualOverrides: { ...link.manualOverrides, column: false },
          manuallyArchived: false,
          updatedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        };
      }
      newState.links = updatedLinks;
      effects.push({ type: 'persistLinks', links: updatedLinks });
      break;
    }

    case 'bulkMoveToProject': {
      const allTmuxNames: string[] = [];
      const updatedLinks = { ...state.links };
      const moveEffects: Effect[] = [];
      for (const cardId of action.cardIds) {
        const link = updatedLinks[cardId];
        if (!link) continue;
        const oldProjectPath = link.projectPath;
        if (link.tmuxLink) {
          allTmuxNames.push(link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? []));
        }
        updatedLinks[cardId] = {
          ...link,
          projectPath: action.projectPath,
          worktreeLink: null,
          prLinks: [],
          discoveredBranches: null,
          discoveredRepos: null,
          tmuxLink: null,
          updatedAt: new Date().toISOString(),
        };
        if (link.sessionLink?.sessionId && link.sessionLink?.sessionPath
            && oldProjectPath !== action.projectPath) {
          moveEffects.push({
            type: 'moveSessionFile',
            cardId,
            sessionId: link.sessionLink.sessionId,
            oldPath: link.sessionLink.sessionPath,
            newProjectPath: action.projectPath,
          });
        }
      }
      newState.links = updatedLinks;
      effects.push({ type: 'persistLinks', links: updatedLinks });
      if (allTmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: allTmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: allTmuxNames });
      }
      effects.push(...moveEffects);
      break;
    }

    case 'bulkDelete': {
      const allTmuxNames: string[] = [];
      const sessionFilesToDelete: string[] = [];
      const allImagePaths: string[] = [];
      const updatedLinks = { ...state.links };
      const deletedCardIdsList = [...state.deletedCardIds];
      const deletedSessionIdsList = [...state.deletedSessionIds];
      for (const cardId of action.cardIds) {
        const link = updatedLinks[cardId];
        if (!link) continue;
        if (link.tmuxLink) {
          allTmuxNames.push(link.tmuxLink.sessionName, ...(link.tmuxLink.extraSessions ?? []));
        }
        if (link.sessionLink?.sessionPath) {
          sessionFilesToDelete.push(link.sessionLink.sessionPath);
        }
        if (link.sessionLink?.sessionId) {
          deletedSessionIdsList.push(link.sessionLink.sessionId);
        }
        deletedCardIdsList.push(cardId);
        allImagePaths.push(
          ...(link.promptImagePaths ?? []),
          ...(link.queuedPrompts ?? []).flatMap(p => p.imagePaths ?? []),
        );
        delete updatedLinks[cardId];
      }
      newState.links = updatedLinks;
      newState.deletedCardIds = deletedCardIdsList;
      newState.deletedSessionIds = deletedSessionIdsList;
      if (newState.selectedCardId && !updatedLinks[newState.selectedCardId]) {
        newState.selectedCardId = null;
      }
      effects.push({ type: 'persistLinks', links: updatedLinks });
      if (allTmuxNames.length > 0) {
        effects.push({ type: 'killTmuxSessions', names: allTmuxNames });
        effects.push({ type: 'cleanupTerminalCache', sessionNames: allTmuxNames });
      }
      for (const filePath of sessionFilesToDelete) {
        effects.push({ type: 'deleteSessionFile', path: filePath });
      }
      if (allImagePaths.length > 0) {
        effects.push({ type: 'deleteFiles', paths: allImagePaths });
      }
      effects.push({ type: 'persistDeletedIds', sessionIds: newState.deletedSessionIds, cardIds: newState.deletedCardIds });
      break;
    }

    case 'loadDeletedIds': {
      newState.deletedSessionIds = [...new Set([...state.deletedSessionIds, ...action.sessionIds])];
      newState.deletedCardIds = [...new Set([...state.deletedCardIds, ...action.cardIds])];
      break;
    }
  }

  return { state: newState, effects };
}
