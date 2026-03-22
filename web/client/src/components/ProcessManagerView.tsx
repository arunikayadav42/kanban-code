/**
 * ProcessManagerView -- 3-tab view for managing processes and worktrees.
 *
 * Tabs: Tmux Sessions, Claude/Gemini Processes (informational), Git Worktrees.
 * Provides refresh, kill, and remove actions.
 *
 * Swift source: Sources/KanbanCode/ProcessManagerView.swift
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { TmuxSession, Worktree } from '@kanban-code/shared';
import { getApiBase } from '../lib/api-client.js';

// MARK: - Types

export type ProcessManagerTab = 'tmux' | 'processes' | 'worktrees';

export interface ProcessInfo {
  pid: number;
  command: string;
  sessionId?: string | null;
}

// MARK: - Props

export interface ProcessManagerViewProps {
  onClose?: () => void;
  /** Fetch tmux sessions -- defaults to GET /api/tmux-sessions */
  fetchTmuxSessions?: () => Promise<TmuxSession[]>;
  /** Fetch worktrees -- defaults to GET /api/worktrees */
  fetchWorktrees?: () => Promise<Worktree[]>;
  /** Kill a tmux session by name */
  onKillTmuxSession?: (name: string) => Promise<void>;
  /** Remove a worktree by path */
  onRemoveWorktree?: (path: string, force: boolean) => Promise<void>;
  /** Navigate to a card by ID */
  onSelectCard?: (cardId: string) => void;
}

// MARK: - Default API functions

async function defaultFetchTmux(): Promise<TmuxSession[]> {
  try {
    const res = await fetch(`${getApiBase()}/tmux-sessions`);
    if (!res.ok) return [];
    const data = await res.json();
    // API returns { sessions: [...] }
    return Array.isArray(data) ? data : (data.sessions ?? []);
  } catch {
    return [];
  }
}

async function defaultFetchWorktrees(): Promise<Worktree[]> {
  try {
    const res = await fetch(`${getApiBase()}/worktrees`);
    if (!res.ok) return [];
    const data = await res.json();
    // API returns { worktrees: { "/repo/path": [Worktree, ...], ... } }
    // Flatten into a single array
    if (Array.isArray(data)) return data;
    const wtMap = data.worktrees ?? data;
    if (typeof wtMap === 'object' && !Array.isArray(wtMap)) {
      const flat: Worktree[] = [];
      for (const worktrees of Object.values(wtMap)) {
        if (Array.isArray(worktrees)) {
          for (const wt of worktrees as Worktree[]) {
            if (!wt.isBare) flat.push(wt);
          }
        }
      }
      return flat;
    }
    return [];
  } catch {
    return [];
  }
}

// MARK: - Component

export default function ProcessManagerView({
  onClose,
  fetchTmuxSessions = defaultFetchTmux,
  fetchWorktrees = defaultFetchWorktrees,
  onKillTmuxSession,
  onRemoveWorktree,
  onSelectCard,
}: ProcessManagerViewProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<ProcessManagerTab>('tmux');
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSession[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load all data
  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [tmux, wt] = await Promise.all([
        fetchTmuxSessions().catch(() => [] as TmuxSession[]),
        fetchWorktrees().catch(() => [] as Worktree[]),
      ]);
      setTmuxSessions(tmux);
      setWorktrees(wt);
    } finally {
      setIsLoading(false);
    }
  }, [fetchTmuxSessions, fetchWorktrees]);

  // Load on mount
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Tab label with count
  const tabLabel = (tab: ProcessManagerTab): string => {
    switch (tab) {
      case 'tmux': return `Tmux (${tmuxSessions.length})`;
      case 'processes': return 'Processes';
      case 'worktrees': return `Worktrees (${worktrees.length})`;
    }
  };

  // Kill tmux session
  const handleKillTmux = useCallback(async (name: string) => {
    if (onKillTmuxSession) {
      await onKillTmuxSession(name);
    }
    setTmuxSessions(prev => prev.filter(s => s.name !== name));
  }, [onKillTmuxSession]);

  // Remove worktree
  const handleRemoveWorktree = useCallback(async (path: string) => {
    if (onRemoveWorktree) {
      await onRemoveWorktree(path, false);
    }
    setWorktrees(prev => prev.filter(w => w.path !== path));
  }, [onRemoveWorktree]);

  const tabs: ProcessManagerTab[] = ['tmux', 'processes', 'worktrees'];

  return (
    <div
      data-testid="process-manager"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        flex: 1,
        minHeight: 0,
        backgroundColor: 'var(--bg-secondary, #1c1c1e)',
        color: 'var(--text-primary, #f5f5f7)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Tab picker */}
      <div
        data-testid="tab-picker"
        style={{
          display: 'flex',
          gap: 0,
          padding: '12px 16px 8px',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            data-testid={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 0',
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab
                ? 'var(--text-primary, #f5f5f7)'
                : 'var(--color-secondary, #8e8e93)',
              backgroundColor: activeTab === tab
                ? 'rgba(255,255,255,0.08)'
                : 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />

      {/* Tab content — scrollable, fills remaining space */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {activeTab === 'tmux' && (
          <TmuxTab
            sessions={tmuxSessions}
            onKill={handleKillTmux}
          />
        )}
        {activeTab === 'processes' && (
          <ProcessesTab />
        )}
        {activeTab === 'worktrees' && (
          <WorktreesTab
            worktrees={worktrees}
            onRemove={handleRemoveWorktree}
          />
        )}
      </div>

      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />

      {/* Bottom bar */}
      <div
        data-testid="bottom-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          gap: 8,
        }}
      >
        <span style={{ flex: 1 }} />
        <button
          data-testid="btn-refresh"
          onClick={loadAll}
          disabled={isLoading}
          title="Refresh"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            background: 'rgba(255,255,255,0.06)',
            border: 'none',
            borderRadius: '50%',
            cursor: 'pointer',
            color: 'var(--text-primary, #f5f5f7)',
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          <RefreshIcon />
        </button>
        {onClose && (
          <button
            data-testid="btn-close"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: 'var(--color-accent, #007AFF)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// MARK: - Tmux Tab

function TmuxTab({
  sessions,
  onKill,
}: {
  sessions: TmuxSession[];
  onKill: (name: string) => void;
}): React.ReactElement {
  if (sessions.length === 0) {
    return (
      <div
        data-testid="tmux-empty"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-secondary, #8e8e93)',
          fontSize: 13,
        }}
      >
        No tmux sessions found
      </div>
    );
  }

  return (
    <div data-testid="tmux-list" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ ...tableRowStyle, fontWeight: 600, fontSize: 11, color: 'var(--color-secondary, #8e8e93)' }}>
        <span style={{ width: 20 }} />
        <span style={{ flex: 2 }}>Name</span>
        <span style={{ flex: 2 }}>Path</span>
        <span style={{ width: 40 }} />
      </div>

      {sessions.map((session) => (
        <div
          key={session.name}
          data-testid={`tmux-row-${session.name}`}
          style={tableRowStyle}
        >
          <span style={{ width: 20 }}>
            <span
              data-testid={`tmux-status-${session.name}`}
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: session.attached ? '#22c55e' : '#6b7280',
              }}
            />
          </span>
          <span title={session.name} style={{ flex: 2, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.name}
            {session.name.includes('card_') && (
              <span style={{
                marginLeft: 6,
                fontSize: 10,
                color: 'var(--color-secondary, #8e8e93)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                padding: '1px 5px',
                borderRadius: 9999,
              }}>
                managed
              </span>
            )}
          </span>
          <span title={session.path} style={{ flex: 2, fontSize: 12, color: 'var(--color-secondary, #8e8e93)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {abbreviatePath(session.path)}
          </span>
          <span style={{ width: 40, textAlign: 'right' }}>
            <button
              data-testid={`kill-tmux-${session.name}`}
              onClick={() => onKill(session.name)}
              title="Kill session"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-secondary, #8e8e93)',
                fontSize: 12,
                padding: 4,
              }}
            >
              <XCircleIcon />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

// MARK: - Processes Tab (Informational)

function ProcessesTab(): React.ReactElement {
  return (
    <div
      data-testid="processes-info"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        color: 'var(--color-secondary, #8e8e93)',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500 }}>
        Claude / Gemini Processes
      </div>
      <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 360 }}>
        In the web version, coding assistant processes are managed through tmux sessions.
        Use the Tmux tab to view and manage active sessions.
      </div>
    </div>
  );
}

// MARK: - Worktrees Tab

function WorktreesTab({
  worktrees,
  onRemove,
}: {
  worktrees: Worktree[];
  onRemove: (path: string) => void;
}): React.ReactElement {
  if (worktrees.length === 0) {
    return (
      <div
        data-testid="worktrees-empty"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-secondary, #8e8e93)',
          fontSize: 13,
        }}
      >
        No worktrees found
      </div>
    );
  }

  return (
    <div data-testid="worktrees-list" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ ...tableRowStyle, fontWeight: 600, fontSize: 11, color: 'var(--color-secondary, #8e8e93)' }}>
        <span style={{ flex: 1 }}>Branch</span>
        <span style={{ flex: 2 }}>Path</span>
        <span style={{ width: 60 }} />
      </div>

      {worktrees.map((wt) => (
        <div
          key={wt.path}
          data-testid={`worktree-row-${wt.path}`}
          style={tableRowStyle}
        >
          <span title={wt.branch ?? wt.path} style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {wt.branch ?? (
              <span style={{ color: 'var(--color-tertiary, #aeaeb2)', fontStyle: 'italic' }}>
                (detached)
              </span>
            )}
          </span>
          <span style={{ flex: 2, fontSize: 12, color: 'var(--color-secondary, #8e8e93)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {abbreviatePath(wt.path)}
          </span>
          <span style={{ width: 60, textAlign: 'right' }}>
            <button
              data-testid={`remove-worktree-${wt.path}`}
              onClick={() => onRemove(wt.path)}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                cursor: 'pointer',
                color: '#ef4444',
              }}
            >
              Remove
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

// MARK: - Helpers

function abbreviatePath(path: string): string {
  // Replace home directory with ~
  const home = '/Users/';
  if (path.startsWith(home)) {
    const rest = path.slice(home.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx >= 0) {
      return '~' + rest.slice(slashIdx);
    }
  }
  return path;
}

// MARK: - Icons

function RefreshIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3a5 5 0 014.546 2.914.5.5 0 00.908-.418A6 6 0 002 8a6 6 0 0011.691 2.01.5.5 0 10-.948-.318A5 5 0 118 3z" />
      <path d="M8 1a.5.5 0 01.5.5v3a.5.5 0 01-1 0v-3A.5.5 0 018 1z" />
      <path d="M8.354 4.854a.5.5 0 000-.708l-2-2a.5.5 0 10-.708.708L7.293 4.5 5.646 6.146a.5.5 0 00.708.708l2-2z" />
    </svg>
  );
}

function XCircleIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
      <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" />
    </svg>
  );
}

// MARK: - Shared Styles

const tableRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};
