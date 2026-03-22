/**
 * CardView — renders a single card on the Kanban board.
 *
 * Swift source: Sources/KanbanCode/CardView.swift
 *
 * Displays: title (2 lines max), project+branch labels, time+badges row,
 * play button for backlog, assistant icon, relative time, PR/issue/tmux badges.
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Link, PRStatus, CardLabel, CodingAssistant } from '@kanban-code/shared';
import {
  getDisplayTitle,
  getDisplayName,
  getShortDisplayName,
  getCardLabel,
  getEffectiveAssistant,
  getWorstPRStatus,
  getTmuxTerminalCount,
  getPrimaryPR,
  getCliCommand,
  getResumeFlag,
  PR_STATUS_COLORS,
  CARD_LABEL_COLORS,
} from '@kanban-code/shared';
import AssistantIcon from './AssistantIcon.js';
import AssistantPill from './AssistantPill.js';
import { getApiBase } from '../lib/api-client.js';

// MARK: - Props

interface CardViewProps {
  link: Link;
  isSelected?: boolean;
  onSelect?: () => void;
  onStart?: () => void;
  onResume?: () => void;
  onFork?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onCleanupWorktree?: () => void;
  onMoveToProject?: (projectPath: string) => void;
  onMigrateAssistant?: (assistant: CodingAssistant) => void;
  availableProjects?: Array<{ path: string; name: string }>;
  enabledAssistants?: CodingAssistant[];
  isChecked?: boolean;
  onToggleCheck?: (cardId: string) => void;
  showCheckbox?: boolean;
  pendingOp?: { type: string; label: string };
}

// MARK: - Component

export default function CardView({
  link,
  isSelected = false,
  onSelect,
  onStart,
  onResume,
  onFork,
  onRename,
  onArchive,
  onDelete,
  onCleanupWorktree,
  onMoveToProject,
  onMigrateAssistant,
  availableProjects = [],
  enabledAssistants = [],
  isChecked = false,
  onToggleCheck,
  showCheckbox = false,
  pendingOp,
}: CardViewProps): React.ReactElement {
  const title = link.displayTitle ?? getDisplayTitle(link);
  const projectName = link.projectName ?? (link.projectPath
    ? link.projectPath.split('/').filter(Boolean).pop() ?? null
    : null);

  // Context menu state
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuPos) return;
    const close = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current && !menuRef.current.contains(target)) setMenuPos(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuPos]);
  const branch = link.worktreeLink?.branch ?? null;
  const cardLabel = link.cardLabel ?? getCardLabel(link);
  const showSpinner = link.isLaunching === true;

  return (
    <div
      data-selected={isSelected ? 'true' : 'false'}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(
          `CONTEXT_MENU cardId=${link.id} hasSession=${!!link.sessionLink} onFork=${!!onFork} onRename=${!!onRename} onResume=${!!onResume} col=${link.column}`
        )}`).catch(() => {});
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        width: '100%',
        backgroundColor: isSelected
          ? 'rgba(0, 122, 255, 0.12)'
          : 'rgba(255, 255, 255, 0.04)',
        borderRadius: 8,
        cursor: 'pointer',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {/* Bulk selection checkbox — visible on hover or when any card is selected */}
      {onToggleCheck && (
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleCheck(link.id)}
          onClick={(e) => e.stopPropagation()}
          className="card-checkbox"
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            width: 14,
            height: 14,
            cursor: 'pointer',
            zIndex: 2,
            accentColor: '#007AFF',
            opacity: (showCheckbox || isChecked) ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
        />
      )}

      {/* Title — 2 lines max */}
      <div
        title={title}
        style={{
          fontWeight: 500,
          fontSize: 14,
          lineHeight: '1.3',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          paddingRight: link.column === 'backlog' || showSpinner ? 40 : 0,
          paddingLeft: onToggleCheck ? 24 : 0,
        }}
      >
        {title}
      </div>

      {/* Project + Assistant + Branch labels */}
      {(projectName || branch || link.assistant != null) && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            fontSize: 11,
            color: 'var(--color-secondary, #8e8e93)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {projectName && (
            <span title={link.projectPath ?? ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <FolderIcon />
              {projectName}
            </span>
          )}
          {link.assistant != null && (
            <span title={getShortDisplayName(link.effectiveAssistant ?? getEffectiveAssistant(link))} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, opacity: 0.7 }}>
              <AssistantIcon assistant={link.effectiveAssistant ?? getEffectiveAssistant(link)} size={11} />
              {getShortDisplayName(link.effectiveAssistant ?? getEffectiveAssistant(link))}
            </span>
          )}
          {branch && (
            <span title={branch ?? ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <BranchIcon />
              {branch}
            </span>
          )}
        </div>
      )}

      {/* Bottom row: label + time + badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
        }}
      >
        {link.cardSourceLabel && link.cardSourceLabel !== cardLabel && (
          <CardLabelBadge label={link.cardSourceLabel} />
        )}
        <CardLabelBadge label={cardLabel} />

        {/* Relative time */}
        <span style={{ color: 'var(--color-tertiary, #aeaeb2)', fontSize: 10 }}>
          {formatRelativeTime(link.lastActivity ?? link.updatedAt)}
        </span>

        <span style={{ flex: 1 }} />

        {/* Badges row */}
        <CardBadgesRow link={link} />
      </div>

      {/* Top-right overlay: spinner or play button */}
      {showSpinner && (
        <div
          data-testid="card-spinner"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 16,
            height: 16,
            border: '2px solid rgba(0,122,255,0.3)',
            borderTopColor: '#007AFF',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      )}
      {!showSpinner && link.column === 'backlog' && (
        <button
          aria-label="Start task"
          onClick={(e) => {
            e.stopPropagation();
            onStart?.();
          }}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px 8px',
            fontSize: 10,
            color: 'rgba(34, 197, 94, 0.8)',
            backgroundColor: 'rgba(34, 197, 94, 0.08)',
            border: 'none',
            borderRadius: 9999,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
          }}
        >
          <PlayIcon />
        </button>
      )}

      {/* Pending op overlay */}
      {pendingOp && (
        <div className="card-pending-overlay">
          <div className="loader" />
          <span className="label">{pendingOp.label}</span>
        </div>
      )}

      {/* Context menu (spec Section 7.5) — rendered via portal to escape overflow clipping */}
      {menuPos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: menuPos.x,
            top: menuPos.y,
            zIndex: 9999,
            minWidth: 200,
            background: 'var(--menu-bg, #1c1c1e)',
            border: '1px solid var(--menu-border, rgba(255,255,255,0.12))',
            borderRadius: 8,
            padding: '4px 0',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            fontSize: 13,
          }}
        >
          {link.column === 'backlog' && onStart && (
            <MenuItem label="Start" onClick={() => { setMenuPos(null); onStart(); }} />
          )}
          {link.column !== 'backlog' && link.sessionLink && onResume && (
            <MenuItem label="Resume Session" onClick={() => { setMenuPos(null); onResume(); }} />
          )}
          {link.sessionLink && onFork && (
            <MenuItem label="Fork Session" onClick={() => { setMenuPos(null); onFork(); }} />
          )}
          {onRename && (
            <MenuItem label="Rename" onClick={() => { setMenuPos(null); onRename(); }} />
          )}
          {link.sessionLink && (
            <MenuItem label="Copy Resume Command" onClick={() => {
              setMenuPos(null);
              const cmd = `cd '${link.projectPath ?? '~'}' && ${getCliCommand(link.effectiveAssistant ?? getEffectiveAssistant(link))} ${getResumeFlag(link.effectiveAssistant ?? getEffectiveAssistant(link))} ${link.sessionLink!.sessionId}`;
              navigator.clipboard.writeText(cmd).catch(() => {});
            }} />
          )}
          <MenuItem label="Copy Card ID" onClick={() => {
            setMenuPos(null);
            navigator.clipboard.writeText(link.id).catch(() => {});
          }} />

          {(link.prLinks.length > 0 || link.issueLink) && <MenuDivider />}
          {link.prLinks.map(pr => pr.url && (
            <MenuItem key={pr.number} label={`Open PR #${pr.number}`} onClick={() => {
              setMenuPos(null);
              window.open(pr.url!, '_blank');
            }} />
          ))}
          {link.issueLink?.url && (
            <MenuItem label={`Open Issue #${link.issueLink.number}`} onClick={() => {
              setMenuPos(null);
              window.open(link.issueLink!.url!, '_blank');
            }} />
          )}

          {link.worktreeLink && onCleanupWorktree && (
            <>
              <MenuDivider />
              <MenuItem label="Cleanup Worktree" destructive onClick={() => { setMenuPos(null); onCleanupWorktree(); }} />
            </>
          )}

          {link.sessionLink && onMoveToProject && availableProjects.length > 0 && (
            <>
              <MenuDivider />
              <MenuSubmenu label="Move to Project →">
                {availableProjects
                  .filter(p => p.path !== link.projectPath)
                  .map(p => (
                    <MenuItem key={p.path} label={p.name} onClick={() => { setMenuPos(null); onMoveToProject(p.path); }} />
                  ))}
              </MenuSubmenu>
            </>
          )}

          {link.sessionLink && onMigrateAssistant && enabledAssistants.length > 1 && (
            <>
              <MenuDivider />
              <MenuSubmenu label="Migrate to Assistant →">
                {enabledAssistants
                  .filter(a => a !== (link.effectiveAssistant ?? getEffectiveAssistant(link)))
                  .map(a => (
                    <MenuItem key={a} label={getDisplayName(a)} onClick={() => { setMenuPos(null); onMigrateAssistant(a); }} />
                  ))}
              </MenuSubmenu>
            </>
          )}

          <MenuDivider />
          {!link.manuallyArchived && onArchive && (
            <MenuItem label="Archive" onClick={() => { setMenuPos(null); onArchive(); }} />
          )}
          {link.source !== 'github_issue' && onDelete && (
            <MenuItem label="Delete Card" destructive onClick={() => {
              setMenuPos(null);
              if (window.confirm('This will permanently delete the card and its session transcript. Continue?')) {
                onDelete();
              }
            }} />
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// MARK: - Context Menu Components

function MenuItem({ label, onClick, destructive = false }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '6px 12px',
        border: 'none',
        background: 'none',
        color: destructive ? 'var(--danger, #ff453a)' : 'var(--text-primary, #e4e4e7)',
        fontSize: 13,
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      {label}
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />;
}

function MenuSubmenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        style={{
          display: 'block',
          width: '100%',
          padding: '6px 12px',
          border: 'none',
          background: 'none',
          color: 'var(--text-primary, #e4e4e7)',
          fontSize: 13,
          textAlign: 'left',
          cursor: 'pointer',
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        {label}
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          left: '100%',
          top: 0,
          minWidth: 180,
          background: 'var(--menu-bg, #1c1c1e)',
          border: '1px solid var(--menu-border, rgba(255,255,255,0.12))',
          borderRadius: 8,
          padding: '4px 0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// MARK: - Card Badges Row

function CardBadgesRow({ link }: { link: Link }): React.ReactElement {
  const primaryPR = getPrimaryPR(link);
  const worstStatus = getWorstPRStatus(link);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* Tmux terminal indicator */}
      {link.tmuxLink && (
        <span
          data-testid="badge-tmux"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            color: '#22c55e',
            fontSize: 10,
          }}
        >
          <TerminalIcon />
          {getTmuxTerminalCount(link.tmuxLink) > 1 && (
            <span style={{ fontWeight: 700 }}>
              {getTmuxTerminalCount(link.tmuxLink)}
            </span>
          )}
        </span>
      )}

      {/* PR badge */}
      {primaryPR && (
        <PRBadge
          status={worstStatus}
          prNumber={primaryPR.number}
        />
      )}

      {/* Extra PR count */}
      {link.prLinks.length > 1 && (
        <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--color-secondary, #8e8e93)' }}>
          +{link.prLinks.length - 1}
        </span>
      )}

      {/* Issue indicator */}
      {link.issueLink && (
        <span
          data-testid="badge-issue"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            fontSize: 10,
            color: 'var(--color-secondary, #8e8e93)',
          }}
        >
          <IssueIcon />
          #{link.issueLink.number}
        </span>
      )}

      {/* Image attachment indicator */}
      {link.promptImagePaths && link.promptImagePaths.length > 0 && (
        <span
          data-testid="badge-image"
          style={{ fontSize: 10, color: 'var(--color-secondary, #8e8e93)' }}
        >
          <ImageIcon />
        </span>
      )}

      {/* Remote indicator */}
      {link.isRemote && (
        <span
          data-testid="badge-remote"
          style={{ fontSize: 10, color: '#2dd4bf' }}
        >
          <CloudIcon />
        </span>
      )}
    </div>
  );
}

// MARK: - Card Label Badge

function CardLabelBadge({ label }: { label: CardLabel }): React.ReactElement {
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

// MARK: - Assistant Icon (delegated to shared AssistantIcon component)

// MARK: - PR Badge

function PRBadge({
  status,
  prNumber,
}: {
  status: PRStatus | null;
  prNumber: number;
}): React.ReactElement {
  const color = getPRStatusColor(status);
  return (
    <span
      data-testid="badge-pr"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        fontSize: 10,
        fontWeight: 500,
        color,
      }}
    >
      <PRIcon />
      #{prNumber}
    </span>
  );
}

function getPRStatusColor(status: PRStatus | null): string {
  return PR_STATUS_COLORS[status ?? 'default'] ?? PR_STATUS_COLORS.default;
}

// MARK: - Relative Time

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// MARK: - SVG Icons (inline, minimal)

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <polygon points="1,0 10,5 1,10" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" opacity={0.5}>
      <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
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

function TerminalIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM7.25 8a.75.75 0 01-.22.53l-2.25 2.25a.75.75 0 11-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 011.06-1.06l2.25 2.25A.75.75 0 017.25 8zm1.5 1.5a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z" />
    </svg>
  );
}

function PRIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
      <path fillRule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h.94l4.72-6.03a.75.75 0 011.18 0L13.28 13.5h.97a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm5.5 3a.5.5 0 11-1 0 .5.5 0 011 0zM5 4.25a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M4.036 4.009a4 4 0 017.869.883 3.25 3.25 0 01-.869 6.108H4.5a3.5 3.5 0 01-.464-6.981z" />
    </svg>
  );
}

