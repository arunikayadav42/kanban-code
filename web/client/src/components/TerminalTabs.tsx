/**
 * TerminalTabs -- multi-tab terminal component.
 *
 * Tab bar showing Claude tab + extra shells (sh1, sh2...), "+" button to add.
 * Each tab manages its own WS connection via the TerminalView component.
 *
 * Swift source: Sources/KanbanCode/TerminalRepresentable.swift (TerminalCache + multi-tab parts)
 * Swift source: Sources/KanbanCode/CardDetailView.swift (terminalView section)
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { Link, QueuedPrompt, CodingAssistant, ImageAttachment } from '@kanban-code/shared';
import { getDisplayName } from '@kanban-code/shared';
import TerminalView from './Terminal.js';
import QueuedPromptDialog from './QueuedPromptDialog.js';

// MARK: - Props

export interface TerminalTabsProps {
  link: Link;
  claudeSession: string | null;
  shellSessions: string[];
  allSessions: string[];
  fontSize: number;
  isLaunching: boolean;
  assistant: CodingAssistant;
  onCreateTerminal?: () => void;
  onKillTerminal?: (session: string) => void;
  onCancelLaunch?: () => void;
  onResume?: () => void;
  queuedPrompts: QueuedPrompt[];
  onSendQueuedPrompt?: (id: string) => void;
  onRemoveQueuedPrompt?: (id: string) => void;
  onAddQueuedPrompt?: (prompt: { body: string; sendAutomatically: boolean; images: ImageAttachment[] }) => void;
  onUpdateQueuedPrompt?: (promptId: string, patch: { body?: string; sendAutomatically?: boolean }) => void;
  onTerminalExit?: (code: number) => void;
}

// MARK: - Component

export default function TerminalTabs({
  link,
  claudeSession,
  shellSessions,
  allSessions,
  fontSize,
  isLaunching,
  assistant,
  onCreateTerminal,
  onKillTerminal,
  onCancelLaunch,
  onResume,
  queuedPrompts,
  onSendQueuedPrompt,
  onRemoveQueuedPrompt,
  onAddQueuedPrompt,
  onUpdateQueuedPrompt,
  onTerminalExit,
}: TerminalTabsProps): React.ReactElement {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<QueuedPrompt | null>(null);
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const tabNames = link.tmuxLink?.tabNames ?? {};
  const assistantLabel = getDisplayName(assistant);

  // The effective active session
  const activeSession = useMemo(() => {
    if (selectedSession === null) return claudeSession;
    return selectedSession;
  }, [selectedSession, claudeSession]);

  // Is the claude tab selected?
  const isClaudeTabSelected = selectedSession === null;

  // Whether we show the overlay instead of the terminal
  const showOverlay = isClaudeTabSelected && activeSession == null;

  // Auto-select new shells when added
  const [prevShellCount, setPrevShellCount] = useState(shellSessions.length);
  useEffect(() => {
    if (shellSessions.length > prevShellCount && shellSessions.length > 0) {
      setSelectedSession(shellSessions[shellSessions.length - 1]);
    }
    setPrevShellCount(shellSessions.length);
  }, [shellSessions, prevShellCount]);

  // If selected session is killed, fallback
  useEffect(() => {
    if (selectedSession && !shellSessions.includes(selectedSession)) {
      setSelectedSession(shellSessions[0] ?? null);
    }
  }, [selectedSession, shellSessions]);

  return (
    <div
      data-testid="terminal-tabs"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Tab bar — only shown when there are extra shell tabs */}
      {shellSessions.length > 0 && (
      <div
        data-testid="terminal-tab-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 16px 4px 16px',
          borderBottom: '1px solid var(--border-primary, rgba(255,255,255,0.08))',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {/* Assistant tab */}
        <TabButton
          data-testid="tab-claude"
          label={assistantLabel}
          isSelected={isClaudeTabSelected}
          isDead={!claudeSession && !isLaunching}
          onClick={() => setSelectedSession(null)}
          onClose={claudeSession ? () => onKillTerminal?.(claudeSession) : undefined}
        />

        {/* Shell tabs */}
        {shellSessions.map((session, i) => {
          const customName = tabNames[session];
          const displayName = customName ?? `shell ${i + 1}`;
          return (
            <TabButton
              key={session}
              data-testid={`tab-shell-${i}`}
              label={displayName}
              isSelected={selectedSession === session}
              onClick={() => setSelectedSession(session)}
              onClose={() => onKillTerminal?.(session)}
            />
          );
        })}

        {/* Add terminal button */}
        <button
          data-testid="add-terminal"
          onClick={onCreateTerminal}
          title="Open new terminal"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            fontSize: 14,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-secondary, #8e8e93)',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          +
        </button>

      </div>
      )}


      {/* Terminal content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Render all active terminals but only show the selected one */}
        {allSessions.map((session) => (
          <div
            key={session}
            style={{
              position: 'absolute',
              inset: 0,
              display: session === activeSession ? 'block' : 'none',
            }}
          >
            <TerminalView
              sessionName={session}
              fontSize={fontSize}
              onExit={onTerminalExit}
            />
          </div>
        ))}

        {/* Overlay for non-terminal states on the Claude tab */}
        {showOverlay && (
          <div
            data-testid="terminal-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              backgroundColor: 'var(--terminal-bg, #121212)',
            }}
          >
            {isLaunching ? (
              <>
                <div
                  data-testid="launch-spinner"
                  style={{
                    width: 32,
                    height: 32,
                    border: '3px solid rgba(0,122,255,0.2)',
                    borderTopColor: '#007AFF',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span style={{ fontSize: 13, color: 'var(--color-secondary, #8e8e93)' }}>
                  Starting session...
                </span>
                {onCancelLaunch && (
                  <button
                    data-testid="cancel-launch"
                    onClick={onCancelLaunch}
                    style={{
                      padding: '4px 12px',
                      fontSize: 12,
                      backgroundColor: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 6,
                      color: 'var(--text-primary, #f5f5f7)',
                      cursor: 'pointer',
                    }}
                  >
                    Stop
                  </button>
                )}
              </>
            ) : link.sessionLink != null ? (
              <>
                <span style={{ fontSize: 14, color: 'var(--color-secondary, #8e8e93)' }}>
                  {assistantLabel} session ended
                </span>
                {onResume && (
                  <button
                    data-testid="resume-session"
                    onClick={onResume}
                    style={{
                      padding: '6px 14px',
                      fontSize: 13,
                      backgroundColor: 'var(--color-accent, #007AFF)',
                      border: 'none',
                      borderRadius: 8,
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    Resume {assistantLabel}
                  </button>
                )}
              </>
            ) : (
              <span style={{ fontSize: 14, color: 'var(--color-secondary, #8e8e93)' }}>
                No agent session
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// MARK: - Tab Button

function TabButton({
  label,
  isSelected,
  isDead,
  onClick,
  onClose,
  ...rest
}: {
  label: string;
  isSelected: boolean;
  isDead?: boolean;
  onClick: () => void;
  onClose?: () => void;
  'data-testid'?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={rest['data-testid']}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        backgroundColor: isSelected ? 'rgba(0,122,255,0.15)' : 'transparent',
        borderRadius: 6,
        opacity: isDead ? 0.5 : 1,
      }}
    >
      <button
        onClick={onClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          fontSize: 12,
          background: 'transparent',
          border: 'none',
          color: isSelected
            ? 'var(--text-primary, #f5f5f7)'
            : 'var(--color-secondary, #8e8e93)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close terminal"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            marginRight: 4,
            fontSize: 8,
            fontWeight: 700,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-secondary, #8e8e93)',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          x
        </button>
      )}
    </div>
  );
}
