/**
 * REST API request/response type definitions.
 * Typed shapes for all REST endpoints.
 *
 * Spec: Section 3.3 (REST API)
 */

import type { Link } from './link.js';
import type { KanbanCodeColumn } from './columns.js';
import type { CodingAssistant } from './coding-assistant.js';
import type { Project } from './project.js';

// --- Request types ---

export interface CreateCardRequest {
  name?: string;
  promptBody?: string;
  projectPath?: string;
  assistant?: CodingAssistant;
}

export interface UpdateCardRequest {
  name?: string;
  column?: KanbanCodeColumn;
  promptBody?: string;
}

export interface LaunchCardRequest {
  prompt: string;
  projectPath: string;
  worktreeName?: string | null;
  runRemotely?: boolean;
  commandOverride?: string | null;
  skipPermissions?: boolean;
}

export interface ReorderCardRequest {
  targetCardId: string;
  above: boolean;
}

export interface ListCardsParams {
  column?: KanbanCodeColumn;
  offset?: number;
  limit?: number;
}

// --- Response types ---

export interface ListCardsResponse {
  cards: Link[];
  total: number;
}

export interface HealthResponse {
  status: 'ok';
  dependencies: {
    /** Dynamic assistant availability keyed by assistant id. */
    assistantAvailability: Record<string, boolean>;
    hooksInstalled: boolean;
    pandocAvailable: boolean;
    wkhtmltoimageAvailable: boolean;
    pushoverConfigured: boolean;
    ghAvailable: boolean;
    ghAuthenticated: boolean;
    tmuxAvailable: boolean;
    mutagenAvailable: boolean;
    assistantHooks: Record<string, boolean>;
  };
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface ErrorResponse {
  error: string;
}

// --- Queued Prompt types ---
export interface AddQueuedPromptRequest { body: string; sendAutomatically: boolean; imagePaths?: string[] }
export interface UpdateQueuedPromptRequest { body?: string; sendAutomatically?: boolean }

// --- Additional response types ---
export interface BulkActionResponse { succeeded: string[]; skipped: string[] }
export interface TmuxSessionsResponse { sessions: import('./tmux-session.js').TmuxSession[] }
export interface WorktreesResponse { worktrees: Record<string, import('./worktree.js').Worktree[]> }
export interface BacklogResponse { backlog: Array<{ project: string; issues: unknown[] }> }
export interface ReorderResponse { ok: true }
export interface HooksStatusResponse { hooks: Record<string, boolean> }

// --- Slice 4 types ---
export interface SendPromptRequest { body: string; imagePaths?: string[] }
export interface AssistantsResponse { assistants: Omit<import('./assistant-descriptor.js').AssistantDescriptor, 'hooks'>[] }
