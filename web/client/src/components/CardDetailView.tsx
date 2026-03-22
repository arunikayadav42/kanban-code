/**
 * CardDetailView -- the main detail panel for a selected card.
 *
 * Renders 5 tabs: Terminal, History, Issue, PR, Prompt.
 * Toolbar with actions menu (Start/Resume/Fork/Queue Prompt/Archive), close button.
 *
 * Swift source: Sources/KanbanCode/CardDetailView.swift
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  Link,
  QueuedPrompt,
  ConversationTurn,
  CodingAssistant,
  PRStatus,
} from '@kanban-code/shared';
import {
  getDisplayTitle,
  getCardLabel,
  getEffectiveAssistant,
  getShortDisplayName,
  getWorstPRStatus,
  getPrimaryPR,
  getMergeablePR,
  getTmuxAllSessionNames,
  PR_STATUS_COLORS,
  CARD_LABEL_COLORS,
} from '@kanban-code/shared';
import AssistantIcon from './AssistantIcon.js';
import AssistantPill from './AssistantPill.js';
import TerminalTabs from './TerminalTabs.js';
import { getApiBase } from '../lib/api-client.js';

// MARK: - Tab Types

export type DetailTab = 'terminal' | 'history' | 'issue' | 'pullRequest' | 'prompt';

export function getInitialTab(link: Link): DetailTab {
  if (link.tmuxLink) return 'terminal';
  if (link.sessionLink) return 'history';
  if (link.issueLink) return 'issue';
  if (link.prLinks.length > 0) return 'pullRequest';
  if (link.promptBody) return 'prompt';
  return 'history';
}

// MARK: - Props

export interface CardDetailViewProps {
  link: Link;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onClose?: () => void;
  onResume?: () => void;
  onFork?: (keepWorktree: boolean) => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onRename?: (name: string) => void;
  onCreateTerminal?: () => void;
  onKillTerminal?: (sessionName: string) => void;
  onCancelLaunch?: () => void;
  onAddQueuedPrompt?: (prompt: QueuedPrompt) => void;
  onSendQueuedPrompt?: (promptId: string) => void;
  onRemoveQueuedPrompt?: (promptId: string) => void;
  onUpdateQueuedPrompt?: (promptId: string, patch: { body?: string; sendAutomatically?: boolean }) => void;
  /** Optional: externally controlled selected tab */
  selectedTab?: DetailTab;
  onTabChange?: (tab: DetailTab) => void;
  /** Session history turns (loaded externally) */
  turns?: ConversationTurn[];
  isLoadingHistory?: boolean;
  /** Terminal font size */
  fontSize?: number;
}

// MARK: - Component

export default function CardDetailView({
  link,
  isExpanded = false,
  onToggleExpand,
  onClose,
  onResume,
  onFork,
  onArchive,
  onDelete,
  onRename,
  onCreateTerminal,
  onKillTerminal,
  onCancelLaunch,
  onAddQueuedPrompt,
  onSendQueuedPrompt,
  onRemoveQueuedPrompt,
  onUpdateQueuedPrompt,
  selectedTab: controlledTab,
  onTabChange,
  turns = [],
  isLoadingHistory = false,
  fontSize = 12,
}: CardDetailViewProps): React.ReactElement {
  // Tab state: controlled or internal
  const [internalTab, setInternalTab] = useState<DetailTab>(() => getInitialTab(link));
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = useCallback(
    (tab: DetailTab) => {
      if (onTabChange) onTabChange(tab);
      else setInternalTab(tab);
    },
    [onTabChange],
  );

  // Reset tab when card changes
  useEffect(() => {
    const newTab = getInitialTab(link);
    fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(
      `DETAIL cardId=${link.id} tmux=${link.tmuxLink?.sessionName ?? 'none'} session=${link.sessionLink?.sessionId?.substring(0, 8) ?? 'none'} initialTab=${newTab}`
    )}`).catch(() => {});
    setActiveTab(newTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.id]);

  // Derived
  const title = getDisplayTitle(link);
  const cardLabel = getCardLabel(link);
  const assistant = getEffectiveAssistant(link);
  const primaryPR = getPrimaryPR(link);
  const worstPRStatus = getWorstPRStatus(link);
  const projectName = link.projectPath?.split('/').filter(Boolean).pop() ?? null;
  const branch = link.worktreeLink?.branch ?? null;
  const isLaunching = link.isLaunching === true;
  const hasSession = link.sessionLink != null;
  const hasTmux = link.tmuxLink != null;
  const showStartResume = !hasTmux;
  const isStart = link.column === 'backlog' || !hasSession;

  // Actions menu state
  const [actionsOpen, setActionsOpen] = useState(false);
  const [showForkConfirm, setShowForkConfirm] = useState(false);

  // Build tab list — Terminal only when tmuxLink exists (live session)
  const tabs = useMemo(() => {
    const result: { id: DetailTab; label: string }[] = [];
    if (link.tmuxLink) result.push({ id: 'terminal', label: 'Terminal' });
    result.push({ id: 'history', label: 'History' });
    if (link.issueLink) result.push({ id: 'issue', label: 'Issue' });
    if (link.prLinks.length > 0) result.push({ id: 'pullRequest', label: 'Pull Request' });
    if (link.promptBody && !link.issueLink) result.push({ id: 'prompt', label: 'Prompt' });
    return result;
  }, [link.tmuxLink, link.issueLink, link.prLinks.length, link.promptBody]);

  return (
    <div
      data-testid="card-detail-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--bg-secondary, #1c1c1e)',
        color: 'var(--text-primary, #f5f5f7)',
      }}
    >
      {/* Minimal toolbar when expanded */}
      {isExpanded && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button
            data-testid="action-collapse"
            onClick={onToggleExpand}
            style={iconButtonStyle}
            title="Collapse"
          >
            <CollapseIcon />
          </button>
          {onClose && (
            <button
              data-testid="action-close-expanded"
              onClick={onClose}
              style={iconButtonStyle}
              title="Close"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      )}

      {/* Full header when not expanded */}
      {!isExpanded && (
        <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {/* Title + Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                data-testid="detail-title"
                title={title}
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {title}
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {/* PR status pill */}
              {primaryPR && (
                <PRStatusPill status={worstPRStatus} number={primaryPR.number} />
              )}

              {/* Start/Resume button */}
              {showStartResume && (
                <button
                  data-testid="action-resume"
                  onClick={onResume}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: isStart ? 'rgba(34,197,94,0.9)' : 'rgba(59,130,246,0.9)',
                    backgroundColor: isStart
                      ? 'rgba(34,197,94,0.08)'
                      : 'rgba(59,130,246,0.08)',
                    border: 'none',
                    borderRadius: 9999,
                    cursor: 'pointer',
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  <PlayIcon />
                  {isStart ? 'Start' : 'Resume'}
                </button>
              )}

              {/* Expand/Collapse */}
              <button
                data-testid="action-expand"
                onClick={onToggleExpand}
                title={isExpanded ? 'Collapse' : 'Expand'}
                style={iconButtonStyle}
              >
                {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
              </button>

              {/* Actions Menu */}
              <div style={{ position: 'relative' }}>
                <button
                  data-testid="actions-menu-trigger"
                  onClick={() => setActionsOpen(!actionsOpen)}
                  style={iconButtonStyle}
                  title="More actions"
                >
                  <EllipsisIcon />
                </button>
                {actionsOpen && (
                  <ActionsMenu
                    link={link}
                    onClose={() => setActionsOpen(false)}
                    onResume={onResume}
                    onFork={() => { setActionsOpen(false); setShowForkConfirm(true); }}
                    onArchive={() => { setActionsOpen(false); onArchive?.(); }}
                    onDelete={() => { setActionsOpen(false); onDelete?.(); }}
                    onRename={onRename ? () => { setActionsOpen(false); /* trigger rename */ } : undefined}
                  />
                )}
              </div>

              {/* Close button */}
              {onClose && (
                <button
                  data-testid="action-close"
                  onClick={onClose}
                  style={iconButtonStyle}
                  title="Close"
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          </div>

          {/* Card metadata row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11 }}>
            {link.cardSourceLabel && link.cardSourceLabel !== cardLabel && (
              <CardLabelBadge label={link.cardSourceLabel} />
            )}
            <CardLabelBadge label={cardLabel} />
            {projectName && (
              <span style={{ color: 'var(--color-secondary, #8e8e93)' }}>
                {projectName}
              </span>
            )}
            {link.assistant != null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--color-secondary, #8e8e93)', opacity: 0.7 }}>
                <AssistantIcon assistant={assistant} size={11} />
                {getShortDisplayName(assistant)}
              </span>
            )}
            {branch && (
              <span style={{ color: 'var(--color-secondary, #8e8e93)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <BranchIcon /> {branch}
              </span>
            )}
            {link.isRemote && (
              <span style={{ color: '#2dd4bf', fontSize: 10 }}>
                Remote
              </span>
            )}
          </div>

          {/* Session ID + Copy tmux attach */}
          {link.sessionLink?.sessionId && (
            <div style={{ marginTop: 4, fontSize: 10, fontFamily: 'monospace', color: 'var(--color-tertiary, #aeaeb2)', display: 'flex', alignItems: 'center', gap: 0 }}>
              <span>{link.sessionLink.sessionId}</span>
              {link.tmuxLink?.sessionName && (
                <>
                  <span style={{ margin: '0 6px', opacity: 0.4 }}>|</span>
                  <button
                    data-testid="copy-tmux-attach"
                    onClick={() => {
                      const cmd = `tmux attach -t ${link.tmuxLink!.sessionName}`;
                      navigator.clipboard.writeText(cmd).catch(() => {});
                    }}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      color: 'var(--accent)', fontSize: 10, fontFamily: 'monospace',
                    }}
                  >
                    copy tmux attach
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab Bar */}
      <div
        data-testid="tab-bar"
        style={{
          display: 'flex',
          gap: 0,
          padding: '0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id
                ? 'var(--text-primary, #f5f5f7)'
                : 'var(--color-secondary, #8e8e93)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id
                ? '2px solid var(--color-accent, #007AFF)'
                : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTab === 'terminal' && (
          <TerminalTabContent
            link={link}
            fontSize={fontSize}
            onCreateTerminal={onCreateTerminal}
            onKillTerminal={onKillTerminal}
            onCancelLaunch={onCancelLaunch}
            onResume={onResume}
            onAddQueuedPrompt={onAddQueuedPrompt}
            onSendQueuedPrompt={onSendQueuedPrompt}
            onRemoveQueuedPrompt={onRemoveQueuedPrompt}
            onUpdateQueuedPrompt={onUpdateQueuedPrompt}
            onTerminalDead={() => setActiveTab('history')}
          />
        )}
        {activeTab === 'history' && (
          <HistoryTabContent
            turns={turns}
            isLoading={isLoadingHistory}
            assistant={assistant}
          />
        )}
        {activeTab === 'issue' && (
          <IssueTabContent link={link} />
        )}
        {activeTab === 'pullRequest' && (
          <PRTabContent link={link} />
        )}
        {activeTab === 'prompt' && (
          <PromptTabContent link={link} />
        )}
      </div>

      {/* Fork Confirmation Dialog */}
      {showForkConfirm && (
        <ConfirmDialog
          title="Fork Session?"
          message={
            link.worktreeLink
              ? 'This creates a duplicate session you can resume independently. Fork from the same worktree or project root?'
              : 'This creates a duplicate session you can resume independently.'
          }
          actions={[
            { label: 'Cancel', onClick: () => setShowForkConfirm(false) },
            ...(link.worktreeLink
              ? [{ label: 'Fork (same worktree)', onClick: () => { setShowForkConfirm(false); onFork?.(true); } }]
              : []),
            { label: 'Fork (project root)', onClick: () => { setShowForkConfirm(false); onFork?.(false); }, primary: true },
          ]}
        />
      )}
    </div>
  );
}

// MARK: - Terminal Tab Content

function TerminalTabContent({
  link,
  fontSize,
  onCreateTerminal,
  onKillTerminal,
  onCancelLaunch,
  onResume,
  onAddQueuedPrompt,
  onSendQueuedPrompt,
  onRemoveQueuedPrompt,
  onUpdateQueuedPrompt,
  onTerminalDead,
}: {
  link: Link;
  fontSize: number;
  onCreateTerminal?: () => void;
  onKillTerminal?: (session: string) => void;
  onCancelLaunch?: () => void;
  onResume?: () => void;
  onAddQueuedPrompt?: (prompt: import('@kanban-code/shared').QueuedPrompt) => void;
  onSendQueuedPrompt?: (id: string) => void;
  onRemoveQueuedPrompt?: (id: string) => void;
  onUpdateQueuedPrompt?: (promptId: string, patch: { body?: string; sendAutomatically?: boolean }) => void;
  onTerminalDead?: () => void;
}): React.ReactElement {
  const hasTmux = link.tmuxLink != null;
  const hasSession = link.sessionLink != null;
  const isLaunching = link.isLaunching === true;
  const assistant = getEffectiveAssistant(link);

  // Determine primary dead / shell-only
  const isPrimaryDead = link.tmuxLink?.isPrimaryDead === true;
  const isShellOnly = link.tmuxLink?.isShellOnly === true;
  const claudeSession = hasTmux && !isShellOnly && !isPrimaryDead
    ? link.tmuxLink!.sessionName
    : null;
  const shellSessions = useMemo(() => {
    if (!link.tmuxLink) return [];
    const extras = link.tmuxLink.extraSessions ?? [];
    if (isShellOnly && !isPrimaryDead) {
      return [link.tmuxLink.sessionName, ...extras];
    }
    return extras;
  }, [link.tmuxLink, isShellOnly, isPrimaryDead]);

  const allSessions = useMemo(() => {
    const result: string[] = [];
    if (claudeSession) result.push(claudeSession);
    result.push(...shellSessions);
    return result;
  }, [claudeSession, shellSessions]);

  if (!hasTmux && !hasSession && !isLaunching) {
    return (
      <div
        data-testid="terminal-empty"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          height: '100%',
          color: 'var(--color-secondary, #8e8e93)',
        }}
      >
        <TerminalIconLarge />
        <span>No session yet</span>
        {onCreateTerminal && (
          <button
            onClick={onCreateTerminal}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              backgroundColor: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: 'var(--text-primary, #f5f5f7)',
              cursor: 'pointer',
            }}
          >
            New Terminal
          </button>
        )}
      </div>
    );
  }

  return (
    <TerminalTabs
      link={link}
      claudeSession={claudeSession}
      shellSessions={shellSessions}
      allSessions={allSessions}
      fontSize={fontSize}
      isLaunching={isLaunching}
      assistant={assistant}
      onCreateTerminal={onCreateTerminal}
      onKillTerminal={onKillTerminal}
      onCancelLaunch={onCancelLaunch}
      onResume={onResume}
      queuedPrompts={link.queuedPrompts ?? []}
      onAddQueuedPrompt={onAddQueuedPrompt ? (p) => onAddQueuedPrompt({ id: '', body: p.body, sendAutomatically: p.sendAutomatically, imagePaths: p.images.length > 0 ? p.images.map(i => i.data) : null }) : undefined}
      onSendQueuedPrompt={onSendQueuedPrompt}
      onRemoveQueuedPrompt={onRemoveQueuedPrompt}
      onUpdateQueuedPrompt={onUpdateQueuedPrompt}
      onTerminalExit={(code) => {
        // If terminal exits with error (dead tmux), auto-switch to history
        if (code !== 0 && onTerminalDead) onTerminalDead();
      }}
    />
  );
}

// MARK: - History Tab Content

function HistoryTabContent({
  turns,
  isLoading,
  assistant,
}: {
  turns: ConversationTurn[];
  isLoading: boolean;
  assistant: CodingAssistant;
}): React.ReactElement {
  if (isLoading && turns.length === 0) {
    return (
      <div
        data-testid="history-loading"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-secondary, #8e8e93)' }}
      >
        Loading history...
      </div>
    );
  }

  if (turns.length === 0) {
    return (
      <div
        data-testid="history-empty"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-secondary, #8e8e93)' }}
      >
        No conversation history
      </div>
    );
  }

  return (
    <div
      data-testid="history-content"
      style={{ overflow: 'auto', height: '100%', padding: 16 }}
    >
      {turns.map((turn) => (
        <div
          key={turn.index}
          style={{
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 12,
                color: turn.role === 'user'
                  ? 'var(--color-accent, #007AFF)'
                  : '#22c55e',
              }}
            >
              {turn.role === 'user' ? 'You' : getShortDisplayName(assistant)}
            </span>
            {turn.timestamp && (
              <span style={{ fontSize: 10, color: 'var(--color-tertiary, #aeaeb2)' }}>
                {new Date(turn.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text-primary, #f5f5f7)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {turn.textPreview}
          </div>
        </div>
      ))}
    </div>
  );
}

// MARK: - Issue Tab Content

function IssueTabContent({ link }: { link: Link }): React.ReactElement {
  const issue = link.issueLink;
  if (!issue) {
    return (
      <div data-testid="issue-empty" style={{ padding: 16, color: 'var(--color-secondary, #8e8e93)' }}>
        No issue linked
      </div>
    );
  }

  return (
    <div data-testid="issue-content" style={{ overflow: 'auto', height: '100%', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {issue.title ?? getDisplayTitle(link)}
          </h3>
          <span style={{ fontSize: 13, color: 'var(--color-secondary, #8e8e93)' }}>
            #{issue.number}
          </span>
        </div>
        {issue.url && (
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: 'var(--color-accent, #007AFF)',
              textDecoration: 'none',
            }}
          >
            Open in Browser
          </a>
        )}
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '12px 0' }} />
      {issue.body ? (
        <div
          data-testid="issue-body"
          style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
        >
          {issue.body}
        </div>
      ) : (
        <div style={{ color: 'var(--color-tertiary, #aeaeb2)', fontStyle: 'italic' }}>
          No description provided.
        </div>
      )}
    </div>
  );
}

// MARK: - PR Tab Content

function PRTabContent({ link }: { link: Link }): React.ReactElement {
  if (link.prLinks.length === 0) {
    return (
      <div data-testid="pr-empty" style={{ padding: 16, color: 'var(--color-secondary, #8e8e93)' }}>
        No pull requests linked
      </div>
    );
  }

  return (
    <div data-testid="pr-content" style={{ overflow: 'auto', height: '100%', padding: 16 }}>
      {link.prLinks.map((pr, index) => (
        <div key={pr.number} style={{ marginBottom: 16 }}>
          {index > 0 && (
            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '16px 0' }} />
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                {pr.title ?? 'Pull Request'}
              </h3>
              <PRStatusPill status={pr.status ?? null} number={pr.number} />
            </div>
            {pr.url && (
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--color-accent, #007AFF)', textDecoration: 'none' }}
              >
                Open in Browser
              </a>
            )}
          </div>

          {/* Checks */}
          {pr.checkRuns && pr.checkRuns.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-secondary, #8e8e93)', marginBottom: 4 }}>
                Checks
              </div>
              {pr.checkRuns.map((check) => (
                <div key={check.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 2 }}>
                  <CheckIcon conclusion={check.conclusion ?? undefined} />
                  <span>{check.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Approvals / Unresolved */}
          {(pr.approvalCount != null || pr.unresolvedThreads != null) && (
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
              {pr.approvalCount != null && pr.approvalCount > 0 && (
                <span style={{ color: '#22c55e' }}>
                  {pr.approvalCount} approval{pr.approvalCount === 1 ? '' : 's'}
                </span>
              )}
              {pr.unresolvedThreads != null && pr.unresolvedThreads > 0 && (
                <span style={{ color: '#f97316' }}>
                  {pr.unresolvedThreads} unresolved
                </span>
              )}
            </div>
          )}

          {/* Body */}
          {pr.body ? (
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {pr.body}
            </div>
          ) : (
            <div style={{ marginTop: 12, color: 'var(--color-tertiary, #aeaeb2)', fontStyle: 'italic' }}>
              No description provided.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// MARK: - Prompt Tab Content

function PromptTabContent({ link }: { link: Link }): React.ReactElement {
  const body = link.promptBody;

  const handleCopy = useCallback(() => {
    if (body) {
      navigator.clipboard.writeText(body).catch(() => {
        // fallback: ignore
      });
    }
  }, [body]);

  return (
    <div data-testid="prompt-content" style={{ overflow: 'auto', height: '100%', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-secondary, #8e8e93)' }}>
          Prompt
        </span>
        <button
          data-testid="copy-prompt"
          onClick={handleCopy}
          style={{
            fontSize: 11,
            color: 'var(--color-secondary, #8e8e93)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          title="Copy prompt"
        >
          Copy
        </button>
      </div>
      {body ? (
        <div
          data-testid="prompt-body"
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
            padding: 12,
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderRadius: 8,
          }}
        >
          {body}
        </div>
      ) : (
        <div style={{ color: 'var(--color-tertiary, #aeaeb2)', fontStyle: 'italic' }}>
          No prompt.
        </div>
      )}
    </div>
  );
}

// MARK: - Actions Menu

function ActionsMenu({
  link,
  onClose,
  onResume,
  onFork,
  onArchive,
  onDelete,
  onRename,
}: {
  link: Link;
  onClose: () => void;
  onResume?: () => void;
  onFork?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
}): React.ReactElement {
  const hasForkableSession = link.sessionLink?.sessionPath != null;

  return (
    <>
      <div
        data-testid="actions-backdrop"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 99 }}
      />
      <div
        data-testid="actions-menu"
        role="menu"
        style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: 4,
          minWidth: 180,
          backgroundColor: 'var(--bg-tertiary, #2c2c2e)',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          padding: '4px 0',
          zIndex: 100,
          fontSize: 13,
        }}
      >
        {onRename && (
          <MenuItem label="Rename" onClick={onRename} />
        )}
        {onFork && (
          <MenuItem label="Fork Session" onClick={onFork} disabled={!hasForkableSession} />
        )}
        {onArchive && (
          <MenuItem label="Archive" onClick={onArchive} />
        )}
        {onDelete && (
          <MenuItem label="Delete" onClick={onDelete} danger />
        )}
      </div>
    </>
  );
}

function MenuItem({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): React.ReactElement {
  return (
    <button
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        padding: '6px 12px',
        textAlign: 'left',
        fontSize: 13,
        color: disabled
          ? 'var(--color-tertiary, #aeaeb2)'
          : danger
            ? '#ef4444'
            : 'var(--text-primary, #f5f5f7)',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// MARK: - Confirm Dialog

function ConfirmDialog({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions: { label: string; onClick: () => void; primary?: boolean }[];
}): React.ReactElement {
  return (
    <div
      data-testid="confirm-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 200,
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-tertiary, #2c2c2e)',
          borderRadius: 12,
          padding: 20,
          maxWidth: 400,
          width: '90%',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{title}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-secondary, #8e8e93)' }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                borderRadius: 6,
                border: action.primary ? 'none' : '1px solid rgba(255,255,255,0.12)',
                backgroundColor: action.primary ? 'var(--color-accent, #007AFF)' : 'transparent',
                color: action.primary ? '#fff' : 'var(--text-primary, #f5f5f7)',
                cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// MARK: - PR Status Pill

function PRStatusPill({ status, number }: { status: PRStatus | null; number: number }): React.ReactElement {
  return (
    <span
      data-testid="pr-status-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        color: getPRStatusColor(status),
      }}
    >
      #{number}
    </span>
  );
}

function getPRStatusColor(status: PRStatus | null): string {
  return PR_STATUS_COLORS[status ?? 'default'] ?? PR_STATUS_COLORS.default;
}

function CheckIcon({ conclusion }: { conclusion?: string }): React.ReactElement {
  const color = conclusion === 'success' ? '#22c55e'
    : conclusion === 'failure' ? '#ef4444'
      : '#eab308';
  return (
    <span style={{ color, fontSize: 12 }}>
      {conclusion === 'success' ? '\u2713' : conclusion === 'failure' ? '\u2717' : '\u25CF'}
    </span>
  );
}

// MARK: - Shared Sub-Components

function CardLabelBadge({ label }: { label: string }): React.ReactElement {
  return (
    <span
      style={{
        fontSize: 8,
        fontWeight: 700,
        color: '#fff',
        backgroundColor: CARD_LABEL_COLORS[label] ?? CARD_LABEL_COLORS.TASK,
        borderRadius: 9999,
        padding: '2px 5px',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {label}
    </span>
  );
}

// AssistantIcon is imported from ./AssistantIcon.js

// MARK: - Icon Button Style

const iconButtonStyle: React.CSSProperties = {
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
  fontSize: 13,
};

// MARK: - SVG Icons

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <polygon points="1,0 10,5 1,10" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="4,12 4,4 12,4" />
      <polyline points="12,4 12,12 4,12" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="6,2 6,6 2,6" />
      <polyline points="10,14 10,10 14,10" />
    </svg>
  );
}

function EllipsisIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="4" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="2" x2="10" y2="10" />
      <line x1="10" y1="2" x2="2" y2="10" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" opacity={0.5}>
      <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6A1 1 0 005 9.5v.878a2.25 2.25 0 11-1.5 0V5.622a2.25 2.25 0 111.5 0v1.878A2.5 2.5 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}

function TerminalIconLarge() {
  return (
    <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" opacity={0.3}>
      <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM7.25 8a.75.75 0 01-.22.53l-2.25 2.25a.75.75 0 11-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 011.06-1.06l2.25 2.25A.75.75 0 017.25 8zm1.5 1.5a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z" />
    </svg>
  );
}
