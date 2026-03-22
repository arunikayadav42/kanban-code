/**
 * BoardView -- horizontal kanban board layout.
 *
 * Swift source: Sources/KanbanCode/BoardView.swift
 *
 * Renders columns horizontally with ColumnView for each visible column.
 * Includes: error banner at bottom, empty state overlay with "New Task" button,
 * auto-scroll to selected card's column.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { Link, KanbanCodeColumn, CodingAssistant } from '@kanban-code/shared';
import { ALL_COLUMNS } from '@kanban-code/shared';
import { KanbanDndContext } from './DragAndDrop';
import ColumnView from './ColumnView';
import { useBoardStore, getCardsInColumn } from '../store/index';

// MARK: - Props

export interface BoardViewProps {
  visibleColumns?: readonly KanbanCodeColumn[];
  onStartCard?: (cardId: string) => void;
  onResumeCard?: (cardId: string) => void;
  onForkCard?: (cardId: string) => void;
  onRenameCard?: (cardId: string) => void;
  onArchiveCard?: (cardId: string) => void;
  onDeleteCard?: (cardId: string) => void;
  onCleanupWorktree?: (cardId: string) => void;
  onMoveToProject?: (cardId: string, projectPath: string) => void;
  onMigrateAssistant?: (cardId: string, assistant: CodingAssistant) => void;
  onMoveCard?: (cardId: string, toColumn: KanbanCodeColumn) => void;
  onMergeCards?: (sourceId: string, targetId: string) => void;
  onReorderCard?: (cardId: string, targetCardId: string, above: boolean) => void;
  onNewTask?: () => void;
  onRefreshBacklog?: () => void;
  isRefreshingBacklog?: boolean;
  availableProjects?: Array<{ path: string; name: string }>;
  enabledAssistants?: CodingAssistant[];
  onBulkArchive?: (cardIds: string[]) => void;
  onBulkResume?: (cardIds: string[]) => void;
  onBulkDelete?: (cardIds: string[]) => void;
  onBulkMoveProject?: (cardIds: string[], projectPath: string) => void;
  pendingOps?: Record<string, { type: string; label: string }>;
}

// MARK: - Component

export default function BoardView({
  visibleColumns = ALL_COLUMNS,
  onStartCard,
  onResumeCard,
  onForkCard,
  onRenameCard,
  onArchiveCard,
  onDeleteCard,
  onCleanupWorktree,
  onMoveToProject,
  onMigrateAssistant,
  onMoveCard,
  onMergeCards,
  onReorderCard,
  onNewTask,
  onRefreshBacklog,
  isRefreshingBacklog = false,
  availableProjects = [],
  enabledAssistants = [],
  onBulkArchive,
  onBulkResume,
  onBulkDelete,
  onBulkMoveProject,
  pendingOps = {},
}: BoardViewProps): React.ReactElement {
  const links = useBoardStore((s) => s.links);
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const selectedProjectPath = useBoardStore((s) => s.selectedProjectPath);
  const selectedAssistant = useBoardStore((s) => s.selectedAssistant);
  const selectedCardType = useBoardStore((s) => s.selectedCardType);
  const selectedProjectPaths = useBoardStore((s) => s.selectedProjectPaths);
  const selectedAssistants = useBoardStore((s) => s.selectedAssistants);
  const selectedCardTypes = useBoardStore((s) => s.selectedCardTypes);
  const error = useBoardStore((s) => s.error);
  const selectCard = useBoardStore((s) => s.selectCard);
  const setError = useBoardStore((s) => s.setError);
  const selectedCardIds = useBoardStore((s) => s.selectedCardIds);
  const toggleCardSelection = useBoardStore((s) => s.toggleCardSelection);
  const selectAllInColumn = useBoardStore((s) => s.selectAllInColumn);
  const deselectAllInColumn = useBoardStore((s) => s.deselectAllInColumn);

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Map<KanbanCodeColumn, HTMLDivElement>>(new Map());

  const filteredLinks = Object.fromEntries(
    Object.entries(links).filter(([, l]) => {
      const projOk = selectedProjectPaths.length > 0
        ? selectedProjectPaths.includes(l.projectPath ?? '')
        : (!selectedProjectPath || l.projectPath === selectedProjectPath);
      const assistOk = selectedAssistants.length > 0
        ? selectedAssistants.includes(l.assistant ?? l.effectiveAssistant ?? '')
        : (!selectedAssistant || l.assistant === selectedAssistant);
      const typeOk = selectedCardTypes.length > 0
        ? selectedCardTypes.includes(l.cardType ?? '')
        : (selectedCardType === 'all' ||
          (selectedCardType === 'sessions' && l.sessionLink != null) ||
          (selectedCardType === 'tasks' && l.source === 'manual') ||
          (selectedCardType === 'issues' && l.source === 'github_issue'));
      return projOk && assistOk && typeOk;
    })
  );
  const allCards = Object.values(filteredLinks);
  const isEmpty = allCards.length === 0;

  // Auto-scroll to selected card's column — only when user clicks a different card
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCardId || !scrollRef.current) return;
    if (prevSelectedRef.current === selectedCardId) return;
    prevSelectedRef.current = selectedCardId;
    for (const col of visibleColumns) {
      const colCards = getCardsInColumn(links, col, selectedProjectPath, selectedAssistant, selectedCardType, selectedProjectPaths, selectedAssistants, selectedCardTypes);
      if (colCards.some((c) => c.id === selectedCardId)) {
        const el = columnRefs.current.get(col);
        if (el?.scrollIntoView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        break;
      }
    }
  }, [selectedCardId, links, visibleColumns]);

  const setColumnRef = useCallback(
    (column: KanbanCodeColumn) => (node: HTMLDivElement | null) => {
      if (node) {
        columnRefs.current.set(column, node);
      } else {
        columnRefs.current.delete(column);
      }
    },
    [],
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

  return (
    <div
      data-testid="board-view"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <KanbanDndContext
        links={links}
        onMoveCard={handleMoveCard}
        onMergeCards={handleMergeCards}
        onReorderCard={handleReorderCard}
      >
        {/* Horizontal scroll area */}
        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            overflowX: 'auto',
            height: '100%',
            gap: 6,
            padding: '52px 16px 16px 16px',
            alignItems: 'flex-start',
          }}
        >
          {visibleColumns.map((column) => (
            <div key={column} ref={setColumnRef(column)}>
              <ColumnView
                column={column}
                cards={getCardsInColumn(links, column, selectedProjectPath, selectedAssistant, selectedCardType, selectedProjectPaths, selectedAssistants, selectedCardTypes)}
                selectedCardId={selectedCardId}
                onSelectCard={selectCard}
                onStartCard={onStartCard}
                onResumeCard={onResumeCard}
                onForkCard={onForkCard}
                onRenameCard={onRenameCard}
                onArchiveCard={onArchiveCard}
                onDeleteCard={onDeleteCard}
                onCleanupWorktree={onCleanupWorktree}
                onMoveToProject={onMoveToProject}
                onMigrateAssistant={onMigrateAssistant}
                availableProjects={availableProjects}
                enabledAssistants={enabledAssistants}
                isRefreshingBacklog={column === 'backlog' ? isRefreshingBacklog : false}
                onRefreshBacklog={column === 'backlog' ? onRefreshBacklog : undefined}
                selectedCardIds={selectedCardIds}
                onToggleCardSelection={toggleCardSelection}
                onSelectAllInColumn={selectAllInColumn}
                onDeselectAllInColumn={deselectAllInColumn}
                onBulkArchive={onBulkArchive}
                onBulkResume={onBulkResume}
                onBulkDelete={onBulkDelete}
                onBulkMoveProject={onBulkMoveProject}
                pendingOps={pendingOps}
              />
            </div>
          ))}
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
            transition: 'opacity 0.25s ease, transform 0.25s ease',
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

      {/* Empty state overlay — only when no filters are active (truly empty board) */}
      {isEmpty && !selectedProjectPath && !selectedAssistant && (selectedCardType as string) === 'all' && (
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
            {selectedCardType === 'tasks' ? 'No tasks found' :
             selectedCardType === 'issues' ? 'No issues found' :
             selectedCardType === 'sessions' ? 'No sessions found' :
             'No cards found'}
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
