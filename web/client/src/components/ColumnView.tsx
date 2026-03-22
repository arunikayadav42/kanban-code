/**
 * ColumnView — a single column on the Kanban board.
 *
 * Swift source: Sources/KanbanCode/ColumnView.swift
 *
 * Displays: header (name + count badge) with glass-style backdrop,
 * scrollable card list, drop zone for DnD.
 * Responsive width: min 240, ideal 280, max 360.
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import type { Link, KanbanCodeColumn, CodingAssistant } from '@kanban-code/shared';
import { getColumnDisplayName } from '@kanban-code/shared';
import CardView from './CardView';
import { getApiBase } from '../lib/api-client.js';

// MARK: - Props

interface ColumnViewProps {
  column: KanbanCodeColumn;
  cards: Link[];
  selectedCardId?: string | null;
  onSelectCard?: (cardId: string | null) => void;
  onStartCard?: (cardId: string) => void;
  onResumeCard?: (cardId: string) => void;
  onForkCard?: (cardId: string) => void;
  onRenameCard?: (cardId: string) => void;
  onArchiveCard?: (cardId: string) => void;
  onDeleteCard?: (cardId: string) => void;
  onCleanupWorktree?: (cardId: string) => void;
  onMoveToProject?: (cardId: string, projectPath: string) => void;
  onMigrateAssistant?: (cardId: string, assistant: CodingAssistant) => void;
  availableProjects?: Array<{ path: string; name: string }>;
  enabledAssistants?: CodingAssistant[];
  isRefreshingBacklog?: boolean;
  onRefreshBacklog?: () => void;
  selectedCardIds?: Set<string>;
  onToggleCardSelection?: (cardId: string) => void;
  onSelectAllInColumn?: (cardIds: string[]) => void;
  onDeselectAllInColumn?: (cardIds: string[]) => void;
  onBulkArchive?: (cardIds: string[]) => void;
  onBulkResume?: (cardIds: string[]) => void;
  onBulkDelete?: (cardIds: string[]) => void;
  onBulkMoveProject?: (cardIds: string[], projectPath: string) => void;
  pendingOps?: Record<string, { type: string; label: string }>;
}

// MARK: - Component

export default function ColumnView({
  column,
  cards,
  selectedCardId = null,
  onSelectCard,
  onStartCard,
  onResumeCard,
  onForkCard,
  onRenameCard,
  onArchiveCard,
  onDeleteCard,
  onCleanupWorktree,
  onMoveToProject,
  onMigrateAssistant,
  availableProjects = [],
  enabledAssistants = [],
  isRefreshingBacklog = false,
  onRefreshBacklog,
  selectedCardIds,
  onToggleCardSelection,
  onSelectAllInColumn,
  onDeselectAllInColumn,
  onBulkArchive,
  onBulkResume,
  onBulkDelete,
  onBulkMoveProject,
  pendingOps = {},
}: ColumnViewProps): React.ReactElement {
  const columnCardIds = cards.map(c => c.id);
  const selectedInColumn = columnCardIds.filter(id => selectedCardIds?.has(id));
  const selectedCount = selectedInColumn.length;
  const allSelected = selectedCount > 0 && selectedCount === cards.length;
  const someSelected = selectedCount > 0 && selectedCount < cards.length;
  const anySelected = selectedCount > 0;

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column}`,
    data: { type: 'column', column },
  });

  return (
    <div
      ref={setNodeRef}
      data-column={column}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 240,
        width: 280,
        maxWidth: 360,
        height: '100%',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        borderRadius: 12,
        border: isOver
          ? '2px solid rgba(0, 122, 255, 0.5)'
          : '1px solid rgba(128, 128, 128, 0.15)',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease',
      }}
    >
      {/* Glass header — floating on top */}
      <div
        data-testid="column-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 12px',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          margin: 4,
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.12)',
          zIndex: 1,
          position: 'sticky',
          top: 0,
        }}
      >
        {/* Three-state select-all checkbox */}
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onChange={() => {
              if (allSelected) {
                onDeselectAllInColumn?.(columnCardIds);
              } else {
                onSelectAllInColumn?.(columnCardIds);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 14,
              height: 14,
              cursor: 'pointer',
              accentColor: '#007AFF',
              marginRight: 6,
            }}
          />
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {getColumnDisplayName(column)}
        </span>

        <span style={{ flex: 1 }} />

        {/* Refresh button for backlog */}
        {onRefreshBacklog && (
          <button
            onClick={onRefreshBacklog}
            disabled={isRefreshingBacklog}
            aria-label="Refresh GitHub issues"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              border: 'none',
              background: 'none',
              cursor: isRefreshingBacklog ? 'not-allowed' : 'pointer',
              opacity: isRefreshingBacklog ? 0.5 : 0.7,
              padding: 0,
              marginRight: 6,
              fontSize: 11,
            }}
          >
            {isRefreshingBacklog ? (
              <span
                style={{
                  width: 12,
                  height: 12,
                  border: '1.5px solid rgba(128,128,128,0.3)',
                  borderTopColor: '#8e8e93',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            ) : (
              <RefreshIcon />
            )}
          </button>
        )}

        {/* Count badge */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: '2px 6px',
            borderRadius: 9999,
            backgroundColor: 'rgba(128, 128, 128, 0.2)',
            color: 'var(--color-secondary, #8e8e93)',
          }}
        >
          {cards.length}
        </span>
      </div>

        {/* Bulk action bar */}
        {anySelected && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              margin: '0 4px',
              fontSize: 11,
              backgroundColor: 'rgba(0, 122, 255, 0.1)',
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 600 }}>{selectedCount} selected</span>
            <button
              onClick={() => onDeselectAllInColumn?.(columnCardIds)}
              style={{ background: 'none', border: 'none', color: '#007AFF', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >
              Deselect
            </button>
            <span style={{ flex: 1 }} />
            <BulkActionsMenu
              selectedIds={selectedInColumn}
              cards={cards}
              onArchive={onBulkArchive}
              onResume={onBulkResume}
              onDelete={onBulkDelete}
              onMoveProject={onBulkMoveProject}
              availableProjects={availableProjects}
            />
          </div>
        )}

      {/* Scrollable card list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {cards.map((link) => (
          <SortableCard
            key={link.id}
            link={link}
            isSelected={link.id === selectedCardId}
            onSelect={() => {
              const newId = selectedCardId === link.id ? null : link.id;
              fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(`click cardId=${link.id} newId=${newId}`)}`).catch(() => {});
              onSelectCard?.(newId);
            }}
            onStart={() => onStartCard?.(link.id)}
            onResume={() => onResumeCard?.(link.id)}
            onFork={() => onForkCard?.(link.id)}
            onRename={() => onRenameCard?.(link.id)}
            onArchive={() => onArchiveCard?.(link.id)}
            onDelete={() => onDeleteCard?.(link.id)}
            onCleanupWorktree={() => onCleanupWorktree?.(link.id)}
            onMoveToProject={(path) => onMoveToProject?.(link.id, path)}
            onMigrateAssistant={(a) => onMigrateAssistant?.(link.id, a)}
            availableProjects={availableProjects}
            enabledAssistants={enabledAssistants}
            isChecked={selectedCardIds?.has(link.id) ?? false}
            onToggleCheck={onToggleCardSelection}
            showCheckbox={anySelected}
            pendingOp={pendingOps[link.id]}
          />
        ))}
      </div>
    </div>
  );
}

// MARK: - Sortable Card Wrapper

interface SortableCardProps {
  link: Link;
  isSelected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onResume: () => void;
  onFork?: () => void;
  onRename?: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCleanupWorktree?: () => void;
  onMoveToProject?: (path: string) => void;
  onMigrateAssistant?: (assistant: CodingAssistant) => void;
  availableProjects?: Array<{ path: string; name: string }>;
  enabledAssistants?: CodingAssistant[];
  isChecked?: boolean;
  onToggleCheck?: (cardId: string) => void;
  showCheckbox?: boolean;
  pendingOp?: { type: string; label: string };
}

function SortableCard({
  link,
  isSelected,
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
  availableProjects,
  enabledAssistants,
  isChecked,
  onToggleCheck,
  showCheckbox,
  pendingOp,
}: SortableCardProps): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: link.id,
    data: { type: 'card', card: link },
  });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      data-testid="card"
      style={style}
      {...attributes}
      {...listeners}
    >
      <CardView
        link={link}
        isSelected={isSelected}
        onSelect={onSelect}
        onStart={onStart}
        onResume={onResume}
        onFork={onFork}
        onRename={onRename}
        onArchive={onArchive}
        onDelete={onDelete}
        onCleanupWorktree={onCleanupWorktree}
        onMoveToProject={onMoveToProject}
        onMigrateAssistant={onMigrateAssistant}
        availableProjects={availableProjects}
        enabledAssistants={enabledAssistants}
        isChecked={isChecked}
        onToggleCheck={onToggleCheck}
        showCheckbox={showCheckbox}
        pendingOp={pendingOp}
      />
    </div>
  );
}

// MARK: - BulkActionsMenu

function BulkActionsMenu({
  selectedIds,
  cards,
  onArchive,
  onResume,
  onDelete,
  onMoveProject,
  availableProjects,
}: {
  selectedIds: string[];
  cards: Link[];
  onArchive?: (ids: string[]) => void;
  onResume?: (ids: string[]) => void;
  onDelete?: (ids: string[]) => void;
  onMoveProject?: (ids: string[], path: string) => void;
  availableProjects?: Array<{ path: string; name: string }>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = selectedIds.length;
  const resumable = selectedIds.filter(id => cards.find(c => c.id === id)?.sessionLink != null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (ref.current && !ref.current.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '3px 10px',
          fontSize: 11,
          fontWeight: 600,
          backgroundColor: '#007AFF',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Actions ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 180,
            backgroundColor: 'var(--color-surface, #1c1c1e)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 100,
          }}
        >
          {onArchive && (
            <button onClick={() => { setOpen(false); onArchive(selectedIds); }} style={menuItemStyle}>
              Archive {count}
            </button>
          )}
          {onResume && resumable.length > 0 && (
            <button onClick={() => { setOpen(false); onResume(resumable); }} style={menuItemStyle}>
              Resume {resumable.length === count ? count : `${resumable.length} of ${count}`}
            </button>
          )}
          {onMoveProject && availableProjects && availableProjects.length > 0 && (
            <MoveToSubmenu
              projects={availableProjects}
              onSelect={(path) => { setOpen(false); onMoveProject(selectedIds, path); }}
            />
          )}
          <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', margin: '2px 0' }} />
          {onDelete && (
            <button onClick={() => { setOpen(false); onDelete(selectedIds); }} style={{ ...menuItemStyle, color: '#ef4444' }}>
              Delete {count}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MoveToSubmenu({ projects, onSelect }: {
  projects: Array<{ path: string; name: string }>;
  onSelect: (path: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!expanded || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    const spaceBelow = window.innerHeight - rect.top;
    const left = spaceRight >= 210 ? rect.right + 2 : rect.left - 210;
    const top = spaceBelow >= 200 ? rect.top : Math.max(8, rect.bottom - 200);
    setPos({ top, left: Math.max(8, left) });
  }, [expanded]);

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;
    const close = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (submenuRef.current?.contains(target)) return;
      setExpanded(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [expanded]);

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={(e) => {
        // Don't close if mouse moved to the portal submenu
        const related = e.relatedTarget;
        if (related instanceof Node && submenuRef.current?.contains(related)) return;
        setExpanded(false);
      }}
    >
      <button
        ref={triggerRef}
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '8px 12px',
          fontSize: 12,
          textAlign: 'left',
          backgroundColor: expanded ? 'rgba(255,255,255,0.06)' : 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        Move to…
        <span style={{ fontSize: 10, opacity: 0.5 }}>▸</span>
      </button>
      {expanded && createPortal(
        <div
          ref={submenuRef}
          onMouseLeave={() => setExpanded(false)}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            minWidth: 200,
            maxHeight: 300,
            overflowY: 'auto',
            backgroundColor: 'var(--color-surface, #1c1c1e)',
            color: 'var(--text-primary, #f5f5f7)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 2000,
          }}
        >
          {projects.map(p => (
            <button
              key={p.path}
              title={p.path}
              onClick={() => onSelect(p.path)}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                fontSize: 12,
                textAlign: 'left',
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--text-primary, #f5f5f7)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  fontSize: 12,
  textAlign: 'left',
  backgroundColor: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
};

// MARK: - Icons

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity={0.7}>
      <path fillRule="evenodd" d="M8 3a5 5 0 104.546 2.914.75.75 0 011.36-.636A6.5 6.5 0 118 1.5v2A.75.75 0 019.25 4h2a.75.75 0 000-1.5H9.876A5.002 5.002 0 008 3z" />
    </svg>
  );
}
