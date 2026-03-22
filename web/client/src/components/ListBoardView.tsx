/**
 * ListBoardView -- vertical list layout for the Kanban board.
 *
 * Swift source: Sources/KanbanCode/ListBoardView.swift
 *
 * Vertical sections per column, collapsible headers (stored in localStorage),
 * drag/drop between sections, column header with toggle+badge+count,
 * selected card highlight, empty section placeholder.
 */

import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import type { Link, KanbanCodeColumn } from '@kanban-code/shared';
import { ALL_COLUMNS, getColumnDisplayName } from '@kanban-code/shared';
import { KanbanDndContext } from './DragAndDrop';
import { useBoardStore, getCardsInColumn } from '../store/index';
import CardView from './CardView';

// MARK: - Column accent colors (matching Swift KanbanCodeColumn.accentColor)

const COLUMN_ACCENT_COLORS: Record<KanbanCodeColumn, string> = {
  backlog: '#8e8e93',
  in_progress: '#22c55e',
  requires_attention: '#f97316',
  in_review: '#3b82f6',
  done: '#a855f7',
  all_sessions: '#8e8e93',
};

// MARK: - localStorage key for collapsed state

const COLLAPSED_KEY = 'listBoardCollapsedColumns';

function loadCollapsed(): Set<KanbanCodeColumn> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    return new Set(raw.split(',').filter(Boolean) as KanbanCodeColumn[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<KanbanCodeColumn>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, Array.from(set).join(','));
  } catch {
    // ignore storage errors
  }
}

// MARK: - Props

export interface ListBoardViewProps {
  visibleColumns?: readonly KanbanCodeColumn[];
  onStartCard?: (cardId: string) => void;
  onResumeCard?: (cardId: string) => void;
  onArchiveCard?: (cardId: string) => void;
  onDeleteCard?: (cardId: string) => void;
  onMoveCard?: (cardId: string, toColumn: KanbanCodeColumn) => void;
  onMergeCards?: (sourceId: string, targetId: string) => void;
  onReorderCard?: (cardId: string, targetCardId: string, above: boolean) => void;
  onNewTask?: () => void;
  onRefreshBacklog?: () => void;
  isRefreshingBacklog?: boolean;
  onBulkArchive?: (cardIds: string[]) => void;
  onBulkResume?: (cardIds: string[]) => void;
  onBulkDelete?: (cardIds: string[]) => void;
  onBulkMoveProject?: (cardIds: string[], projectPath: string) => void;
  pendingOps?: Record<string, { type: string; label: string }>;
}

// MARK: - Component

export default function ListBoardView({
  visibleColumns = ALL_COLUMNS,
  onStartCard,
  onResumeCard,
  onArchiveCard,
  onDeleteCard,
  onMoveCard,
  onMergeCards,
  onReorderCard,
  onNewTask,
  onRefreshBacklog,
  isRefreshingBacklog = false,
  onBulkArchive,
  onBulkResume,
  onBulkDelete,
  onBulkMoveProject,
  pendingOps,
}: ListBoardViewProps): React.ReactElement {
  const links = useBoardStore((s) => s.links);
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const error = useBoardStore((s) => s.error);
  const selectCard = useBoardStore((s) => s.selectCard);
  const setError = useBoardStore((s) => s.setError);
  const selectedCardIds = useBoardStore((s) => s.selectedCardIds);
  const toggleCardSelection = useBoardStore((s) => s.toggleCardSelection);
  const selectAllInColumn = useBoardStore((s) => s.selectAllInColumn);
  const deselectAllInColumn = useBoardStore((s) => s.deselectAllInColumn);

  const [collapsed, setCollapsed] = useState<Set<KanbanCodeColumn>>(loadCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const allCards = Object.values(links);
  const isEmpty = allCards.length === 0;

  // Persist collapsed state
  const toggleCollapse = useCallback((column: KanbanCodeColumn) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(column)) {
        next.delete(column);
      } else {
        next.add(column);
      }
      saveCollapsed(next);
      return next;
    });
  }, []);

  // Auto-scroll to selected card — only when user clicks a different card
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCardId) return;
    if (prevSelectedRef.current === selectedCardId) return;
    prevSelectedRef.current = selectedCardId;
    const el = cardRefs.current.get(selectedCardId);
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedCardId]);

  const setCardRef = useCallback(
    (cardId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        cardRefs.current.set(cardId, node);
      } else {
        cardRefs.current.delete(cardId);
      }
    },
    [],
  );

  const handleSelectCard = useCallback(
    (cardId: string) => {
      const newId = selectedCardId === cardId ? null : cardId;
      selectCard(newId);
    },
    [selectedCardId, selectCard],
  );

  const handleMoveCard = useCallback(
    (cardId: string, toColumn: KanbanCodeColumn) => {
      onMoveCard?.(cardId, toColumn);
    },
    [onMoveCard],
  );

  const handleMergeCards = useCallback(
    (sourceId: string, targetId: string) => {
      onMergeCards?.(sourceId, targetId);
    },
    [onMergeCards],
  );

  const handleReorderCard = useCallback(
    (cardId: string, targetCardId: string, above: boolean) => {
      onReorderCard?.(cardId, targetCardId, above);
    },
    [onReorderCard],
  );

  const selectedProjectPath = useBoardStore((s) => s.selectedProjectPath);
  const selectedAssistant = useBoardStore((s) => s.selectedAssistant);
  const selectedCardType = useBoardStore((s) => s.selectedCardType);
  const selectedProjectPaths = useBoardStore((s) => s.selectedProjectPaths);
  const selectedAssistants = useBoardStore((s) => s.selectedAssistants);
  const selectedCardTypes = useBoardStore((s) => s.selectedCardTypes);

  // Build sections
  const sections = useMemo(() => {
    return visibleColumns.map((column) => ({
      column,
      cards: getCardsInColumn(links, column, selectedProjectPath, selectedAssistant, selectedCardType, selectedProjectPaths, selectedAssistants, selectedCardTypes),
    }));
  }, [visibleColumns, links, selectedProjectPath, selectedAssistant, selectedCardType, selectedProjectPaths, selectedAssistants, selectedCardTypes]);

  return (
    <div
      data-testid="list-board-view"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {/* Global bulk action bar for list view */}
      {selectedCardIds.size > 0 && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            backgroundColor: 'rgba(0, 122, 255, 0.1)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            fontSize: 12,
          }}
        >
          <span style={{ fontWeight: 600 }}>{selectedCardIds.size} selected</span>
          <button onClick={() => deselectAllInColumn([...selectedCardIds])} style={{ background: 'none', border: 'none', color: '#007AFF', cursor: 'pointer', fontSize: 12, padding: 0 }}>
            Deselect
          </button>
          <span style={{ flex: 1 }} />
          <ListBulkActionsMenu
            selectedIds={[...selectedCardIds]}
            links={links}
            onArchive={onBulkArchive}
            onResume={onBulkResume}
            onDelete={onBulkDelete}
          />
        </div>
      )}

      <KanbanDndContext
        links={links}
        onMoveCard={handleMoveCard}
        onMergeCards={handleMergeCards}
        onReorderCard={handleReorderCard}
      >
        <div
          ref={scrollRef}
          style={{
            overflowY: 'auto',
            height: '100%',
            padding: '52px 16px 16px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              maxWidth: 900,
            }}
          >
            {sections.map(({ column, cards }) => (
              <ListSection
                key={column}
                column={column}
                cards={cards}
                isCollapsed={collapsed.has(column)}
                selectedCardId={selectedCardId}
                isRefreshingBacklog={column === 'backlog' ? isRefreshingBacklog : false}
                onToggleCollapse={() => toggleCollapse(column)}
                onSelectCard={handleSelectCard}
                onStartCard={onStartCard}
                onResumeCard={onResumeCard}
                onArchiveCard={onArchiveCard}
                onDeleteCard={onDeleteCard}
                onRefreshBacklog={column === 'backlog' ? onRefreshBacklog : undefined}
                setCardRef={setCardRef}
                selectedCardIds={selectedCardIds}
                onToggleCardSelection={toggleCardSelection}
                onSelectAllInColumn={selectAllInColumn}
                onDeselectAllInColumn={deselectAllInColumn}
              />
            ))}
          </div>
        </div>
      </KanbanDndContext>

      {/* Error banner at bottom */}
      {error && (
        <div
          data-testid="error-banner"
          style={{
            position: 'absolute',
            bottom: 12,
            left: 16,
            right: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 20px',
            backgroundColor: 'rgba(30, 30, 30, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 12,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
          }}
        >
          <WarningIcon />
          <span
            style={{
              flex: 1,
              fontWeight: 500,
              fontSize: 14,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {error}
          </span>
          <button
            onClick={() => setError(null)}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid rgba(128, 128, 128, 0.3)',
              borderRadius: 6,
              backgroundColor: 'rgba(128, 128, 128, 0.1)',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Empty state overlay — only when truly empty (no filters active) */}
      {isEmpty && !selectedProjectPath && !selectedAssistant && selectedCardType === 'all' && (
        <div
          data-testid="empty-state"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: 'var(--color-secondary, #8e8e93)',
            }}
          >
            No sessions found
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--color-tertiary, #aeaeb2)',
            }}
          >
            Create a new task or start a Claude session to get going.
          </span>
          {onNewTask && (
            <button
              data-testid="new-task-button"
              onClick={onNewTask}
              style={{
                pointerEvents: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                backgroundColor: '#007AFF',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <PlusIcon />
              New Task
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// MARK: - ListSection

interface ListSectionProps {
  column: KanbanCodeColumn;
  cards: Link[];
  isCollapsed: boolean;
  selectedCardId: string | null;
  isRefreshingBacklog: boolean;
  onToggleCollapse: () => void;
  onSelectCard: (cardId: string) => void;
  onStartCard?: (cardId: string) => void;
  onResumeCard?: (cardId: string) => void;
  onArchiveCard?: (cardId: string) => void;
  onDeleteCard?: (cardId: string) => void;
  onRefreshBacklog?: () => void;
  setCardRef: (cardId: string) => (node: HTMLDivElement | null) => void;
  selectedCardIds: Set<string>;
  onToggleCardSelection: (cardId: string) => void;
  onSelectAllInColumn: (cardIds: string[]) => void;
  onDeselectAllInColumn: (cardIds: string[]) => void;
}

function ListSection({
  column,
  cards,
  isCollapsed,
  selectedCardId,
  isRefreshingBacklog,
  onToggleCollapse,
  onSelectCard,
  onStartCard,
  onResumeCard,
  onArchiveCard,
  onDeleteCard,
  onRefreshBacklog,
  setCardRef,
  selectedCardIds,
  onToggleCardSelection,
  onSelectAllInColumn,
  onDeselectAllInColumn,
}: ListSectionProps): React.ReactElement {
  const checkedCount = cards.filter((c) => selectedCardIds.has(c.id)).length;
  const allChecked = cards.length > 0 && checkedCount === cards.length;
  const someChecked = checkedCount > 0 && checkedCount < cards.length;
  const showCheckbox = selectedCardIds.size > 0;
  const accentColor = COLUMN_ACCENT_COLORS[column];

  return (
    <div data-testid={`list-section-${column}`}>
      {/* Section header */}
      <div
        data-testid={`section-header-${column}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 14px',
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 12,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onToggleCollapse}
      >
        {/* Chevron */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{
            opacity: 0.5,
            transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.2s ease',
            fontWeight: 700,
          }}
        >
          <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
        </svg>

        {/* Color dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: accentColor,
            marginLeft: 10,
            flexShrink: 0,
          }}
        />

        {/* Column name */}
        <span
          style={{
            marginLeft: 10,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {getColumnDisplayName(column)}
        </span>

        {/* Count badge */}
        <span
          style={{
            marginLeft: 8,
            fontSize: 11,
            fontWeight: 500,
            padding: '2px 6px',
            borderRadius: 9999,
            backgroundColor: 'rgba(128, 128, 128, 0.16)',
            color: 'var(--color-secondary, #8e8e93)',
          }}
        >
          {cards.length}
        </span>

        <span style={{ flex: 1 }} />

        {/* Three-state column selection checkbox */}
        {showCheckbox && (
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked;
            }}
            onChange={(e) => {
              e.stopPropagation();
              const cardIds = cards.map(c => c.id);
              if (allChecked || someChecked) {
                onDeselectAllInColumn(cardIds);
              } else {
                onSelectAllInColumn(cardIds);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select all cards in ${column}`}
            style={{ marginRight: 8, cursor: 'pointer' }}
          />
        )}

        {/* Refresh button for backlog */}
        {onRefreshBacklog && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefreshBacklog();
            }}
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
              color: 'inherit',
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
      </div>

      {/* Section body */}
      {!isCollapsed && (
        <div
          style={{
            marginTop: 6,
            transition: 'opacity 0.2s ease',
          }}
        >
          {cards.length === 0 ? (
            <div
              data-testid={`empty-section-${column}`}
              style={{
                height: 52,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                border: '1px dashed rgba(128, 128, 128, 0.2)',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                margin: '0 8px',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--color-tertiary, #aeaeb2)',
                }}
              >
                No cards
              </span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 8,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 12,
                border: '1px solid rgba(128, 128, 128, 0.1)',
              }}
            >
              {cards.map((card) => (
                <div key={card.id} ref={setCardRef(card.id)}>
                  <CardView
                    link={card}
                    isSelected={card.id === selectedCardId}
                    onSelect={() => onSelectCard(card.id)}
                    onStart={() => onStartCard?.(card.id)}
                    onResume={() => onResumeCard?.(card.id)}
                    onArchive={() => onArchiveCard?.(card.id)}
                    onDelete={() => onDeleteCard?.(card.id)}
                    isChecked={selectedCardIds.has(card.id)}
                    onToggleCheck={onToggleCardSelection}
                    showCheckbox={showCheckbox}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// MARK: - Icons

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="#f97316" opacity={0.7}>
      <path
        fillRule="evenodd"
        d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z" />
    </svg>
  );
}

function ListBulkActionsMenu({
  selectedIds,
  links,
  onArchive,
  onResume,
  onDelete,
}: {
  selectedIds: string[];
  links: Record<string, Link>;
  onArchive?: (ids: string[]) => void;
  onResume?: (ids: string[]) => void;
  onDelete?: (ids: string[]) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = selectedIds.length;
  const resumable = selectedIds.filter(id => links[id]?.sessionLink != null);

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

  const itemStyle: React.CSSProperties = {
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

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, backgroundColor: '#007AFF', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
      >
        Actions ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 180, backgroundColor: 'var(--color-surface, #1c1c1e)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 100, overflow: 'hidden' }}>
          {onArchive && (
            <button onClick={() => { setOpen(false); onArchive(selectedIds); }} style={itemStyle}>Archive {count}</button>
          )}
          {onResume && resumable.length > 0 && (
            <button onClick={() => { setOpen(false); onResume(resumable); }} style={itemStyle}>
              Resume {resumable.length === count ? count : `${resumable.length} of ${count}`}
            </button>
          )}
          {onDelete && (
            <>
              <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', margin: '2px 0' }} />
              <button onClick={() => { setOpen(false); onDelete(selectedIds); }} style={{ ...itemStyle, color: '#ef4444' }}>Delete {count}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity={0.7}>
      <path fillRule="evenodd" d="M8 3a5 5 0 104.546 2.914.75.75 0 011.36-.636A6.5 6.5 0 118 1.5v2A.75.75 0 019.25 4h2a.75.75 0 000-1.5H9.876A5.002 5.002 0 008 3z" />
    </svg>
  );
}
