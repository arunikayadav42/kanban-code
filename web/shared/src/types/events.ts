/**
 * SSE event type definitions.
 * Typed payloads for all named Server-Sent Events.
 *
 * Spec: Section 3.2 (SSE), Section 5.1 (Server-Side Reducer)
 */

import type { Link } from './link.js';
import type { Session } from './session.js';
import type { ActivityState } from './activity-state.js';
import type { Project } from './project.js';

/** All SSE event names. */
export const SSE_EVENT_TYPES = [
  'state:snapshot',
  'card:updated', 'card:deleted', 'cards:reordered', 'cards:reconciled',
  'activity:changed',
  'launch:completed', 'launch:failed',
  'resume:completed', 'resume:failed',
  'terminal:created', 'terminal:failed',
  'github:issues-updated', 'github:rate-limited',
  'settings:loaded', 'migration:failed',
  'error', 'loading', 'backlog:refreshing',
] as const;

export type SSEEventType = typeof SSE_EVENT_TYPES[number];

/** Full state snapshot sent on initial SSE connection. */
export interface StateSnapshot {
  links: Record<string, Link>;
  sessions: Record<string, Session>;
  activityMap: Record<string, ActivityState>;
  tmuxSessions: string[];
  configuredProjects: Project[];
  selectedCardId: string | null;
  error: string | null;
  isLoading: boolean;
}

/** Payload for card:updated events. */
export interface CardUpdatedEvent {
  state: { links: Record<string, Link> };
}

/** Payload for card:deleted events. */
export interface CardDeletedEvent {
  cardId: string;
  state: { links: Record<string, Link> };
}

/** Payload for activity:changed events. */
export interface ActivityChangedEvent {
  activityMap: Record<string, ActivityState>;
}

/** Payload for launch/resume completion events. */
export interface LaunchCompletedEvent {
  cardId: string;
  state: { links: Record<string, Link> };
}

/** Payload for launch/resume failure events. */
export interface LaunchFailedEvent {
  cardId: string;
  error: string;
  state: { links: Record<string, Link> };
}

export interface CardsReorderedEvent { state: { links: Record<string, Link> } }
export interface CardsReconciledEvent { state: StateSnapshot }
export interface TerminalCreatedEvent { cardId: string; state: { links: Record<string, Link> } }
export interface TerminalFailedEvent { cardId: string; error: string; state: { links: Record<string, Link>; error: string } }
export interface SSEErrorEvent { message: string; state: { error: string } }
export interface LoadingEvent { isLoading: boolean; state: { isLoading: boolean } }
export interface BacklogRefreshingEvent { isRefreshingBacklog: boolean; state: { isRefreshingBacklog: boolean } }
export interface SettingsLoadedEvent { state: { configuredProjects: Project[]; excludedPaths: string[] } }
export interface GithubIssuesUpdatedEvent { state: { links: Record<string, Link>; lastGitHubRefresh: string } }
export interface GithubRateLimitedEvent { repos: string[]; state: { rateLimitedRepos: string[] } }
export interface MigrationFailedEvent { cardId: string; error: string; state: { links: Record<string, Link>; error: string } }

/** Generic SSE event data wrapper. */
export interface SSEEventData {
  state?: Partial<StateSnapshot>;
  cardId?: string;
  error?: string;
  activityMap?: Record<string, ActivityState>;
}
