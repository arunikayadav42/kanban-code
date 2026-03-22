/**
 * REST API client for card operations.
 * Spec: Section 3.3 (REST API)
 */

import type {
  Link, CreateCardRequest, UpdateCardRequest, LaunchCardRequest,
  ListCardsResponse, HealthResponse, ProjectsResponse,
  QueuedPrompt, StateSnapshot, AssistantsResponse,
} from '@kanban-code/shared';
import { useBoardStore } from '../store/index.js';

function isValidBackendUrl(url: string): boolean {
  try { return /^https?:\/\/.+/.test(url) && Boolean(new URL(url)); } catch { return false; }
}

export function getApiBase(): string {
  const backendUrl = useBoardStore.getState().backendUrl;
  return backendUrl && isValidBackendUrl(backendUrl)
    ? `${backendUrl.replace(/\/$/, '')}/api`
    : '/api';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Cards
  getCards: (params?: { column?: string; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.column) qs.set('column', params.column);
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<ListCardsResponse>(`/cards${query ? '?' + query : ''}`);
  },
  createCard: (data: CreateCardRequest) =>
    request<Link>('/cards', { method: 'POST', body: JSON.stringify(data) }),
  updateCard: (id: string, data: UpdateCardRequest) =>
    request<Link>(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCard: (id: string) =>
    request<void>(`/cards/${id}`, { method: 'DELETE' }),
  archiveCard: (id: string) =>
    request<Link>(`/cards/${id}/archive`, { method: 'POST' }),
  launchCard: (id: string, data: LaunchCardRequest) =>
    request<Link>(`/cards/${id}/launch`, { method: 'POST', body: JSON.stringify(data) }),
  resumeCard: (id: string) =>
    request<Link>(`/cards/${id}/resume`, { method: 'POST' }),
  cancelLaunch: (id: string) =>
    request<Link>(`/cards/${id}/cancel-launch`, { method: 'POST' }),

  bulkArchive: (cardIds: string[]) =>
    request<{ succeeded: string[]; skipped: string[] }>('/cards/bulk-archive', {
      method: 'POST',
      body: JSON.stringify({ cardIds }),
    }),

  bulkResume: (cardIds: string[]) =>
    request<{ succeeded: string[]; skipped: string[] }>('/cards/bulk-resume', {
      method: 'POST',
      body: JSON.stringify({ cardIds }),
    }),

  bulkMoveProject: (cardIds: string[], projectPath: string) =>
    request<{ succeeded: string[]; skipped: string[] }>('/cards/bulk-move-project', {
      method: 'POST',
      body: JSON.stringify({ cardIds, projectPath }),
    }),

  bulkDelete: (cardIds: string[]) =>
    request<{ succeeded: string[]; skipped: string[] }>('/cards/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ cardIds }),
    }),

  moveCardToProject: (id: string, projectPath: string) =>
    request<Link>(`/cards/${id}/move-to-project`, {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    }),

  forkCard: (id: string) =>
    request<Link>(`/cards/${id}/fork`, { method: 'POST' }),

  // Queued prompts
  addQueuedPrompt: (cardId: string, body: string, sendAutomatically: boolean, imagePaths?: string[]) =>
    request<QueuedPrompt>(`/cards/${cardId}/queued-prompts`, {
      method: 'POST', body: JSON.stringify({ body, sendAutomatically, imagePaths }),
    }),
  removeQueuedPrompt: (cardId: string, promptId: string) =>
    request<Link>(`/cards/${cardId}/queued-prompts/${promptId}`, { method: 'DELETE' }),
  sendQueuedPrompt: (cardId: string, promptId: string) =>
    request<Link>(`/cards/${cardId}/queued-prompts/${promptId}/send`, { method: 'POST' }),
  updateQueuedPrompt: (cardId: string, promptId: string, patch: { body?: string; sendAutomatically?: boolean }) =>
    request<Link>(`/cards/${cardId}/queued-prompts/${promptId}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),

  sendPrompt: (cardId: string, body: string, imagePaths?: string[]) =>
    request<void>(`/cards/${cardId}/send-prompt`, {
      method: 'POST', body: JSON.stringify({ body, imagePaths }),
    }),

  fetchState: () => request<StateSnapshot>('/state'),
  getAssistants: () => request<AssistantsResponse>('/assistants'),

  // History
  getCardHistory: (id: string, maxTurns = 80) =>
    request<{ turns: any[]; totalLineCount: number; hasMore: boolean }>(
      `/cards/${id}/history?maxTurns=${maxTurns}`,
    ),

  // Settings
  getSettings: () => request<Record<string, unknown>>('/settings'),
  patchSettings: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  getProjects: () => request<ProjectsResponse>('/projects'),
  hideProject: (path: string) =>
    request<{ hidden: boolean; path: string }>('/projects/hide', { method: 'POST', body: JSON.stringify({ path }) }),
  unhideProject: (path: string) =>
    request<{ hidden: boolean; path: string }>('/projects/unhide', { method: 'POST', body: JSON.stringify({ path }) }),

  // Rediscovery
  rediscover: () =>
    request<{ wiped: number; kept: number }>('/rediscover', { method: 'POST' }),

  // Sync (sessions, PRs, worktrees — on demand)
  sync: () =>
    request<{ ok: boolean }>('/sync', { method: 'POST' }),

  // Hooks
  installHooks: (assistant: string) =>
    request<{ ok: boolean }>('/hooks/install', { method: 'POST', body: JSON.stringify({ assistant }) }),
  uninstallHooks: (assistant: string) =>
    request<{ ok: boolean }>('/hooks/uninstall', { method: 'POST', body: JSON.stringify({ assistant }) }),
  getHookStatus: () =>
    request<{ hooks: Record<string, boolean> }>('/hooks/status'),

  // Health
  getHealth: () => request<HealthResponse>('/health'),
};
