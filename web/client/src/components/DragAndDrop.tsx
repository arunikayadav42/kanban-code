/**
 * DragAndDrop — React DnD context, state, and visual indicators for the Kanban board.
 *
 * Swift source: Sources/KanbanCode/DragAndDrop.swift
 *
 * Uses @dnd-kit/core for drag-and-drop. Provides:
 * - DragState type and factory
 * - KanbanDndContext provider
 * - Visual indicators: ReorderIndicator, InvalidDropBadge, MergeBadge
 * - Color scheme: orange = merge, green = reorder, red = invalid
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import type { Link, KanbanCodeColumn } from '@kanban-code/shared';
import { mergeBlocked } from '@kanban-code/shared';

// MARK: - Drag State

export interface DragState {
  /** The card (Link) currently being dragged. */
  draggingCard: Link | null;
  /** Column the dragged card originated from. */
  sourceColumn: KanbanCodeColumn | null;
  /** Card ID the cursor is currently over (merge candidate). */
  mergeTargetId: string | null;
  /** Drop insertion indicator for same-column reordering. */
  reorderTargetId: string | null;
  /** Whether to insert above (true) or below (false) the reorder target. */
  reorderAbove: boolean;
}

export function createInitialDragState(): DragState {
  return {
    draggingCard: null,
    sourceColumn: null,
    mergeTargetId: null,
    reorderTargetId: null,
    reorderAbove: true,
  };
}

// MARK: - Context

interface DragContextValue {
  dragState: DragState;
}

const DragContext = createContext<DragContextValue>({
  dragState: createInitialDragState(),
});

export function useDragState(): DragState {
  return useContext(DragContext).dragState;
}

// MARK: - Visual Indicators

/** Horizontal line indicator shown between cards during reorder. */
export function ReorderIndicator(): React.ReactElement {
  return (
    <div
      data-testid="reorder-indicator"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 4px',
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: 'var(--color-accent, #007AFF)',
        }}
      />
      <div
        style={{
          flex: 1,
          height: 2,
          backgroundColor: 'var(--color-accent, #007AFF)',
        }}
      />
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: 'var(--color-accent, #007AFF)',
        }}
      />
    </div>
  );
}

/** Red badge shown when a drop is not allowed. */
export function InvalidDropBadge(): React.ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        color: '#fff',
        backgroundColor: '#ef4444',
        borderRadius: 9999,
        padding: '2px 8px',
      }}
    >
      Not allowed
    </span>
  );
}

/** Orange badge shown when hovering over a merge target. */
export function MergeBadge(): React.ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        fontWeight: 600,
        color: '#fff',
        backgroundColor: '#f97316',
        borderRadius: 9999,
        padding: '2px 8px',
      }}
    >
      Merge
    </span>
  );
}

// MARK: - DnD Context Provider

interface KanbanDndContextProps {
  children: React.ReactNode;
  /** All links indexed by ID, used for merge validation. */
  links?: Record<string, Link>;
  onMoveCard: (cardId: string, toColumn: KanbanCodeColumn) => void;
  onMergeCards: (sourceId: string, targetId: string) => void;
  onReorderCard: (cardId: string, targetCardId: string, above: boolean) => void;
}

/**
 * Top-level DnD context that wraps the board.
 * Manages drag state and dispatches move/merge/reorder actions on drop.
 */
export function KanbanDndContext({
  children,
  links = {},
  onMoveCard,
  onMergeCards,
  onReorderCard,
}: KanbanDndContextProps): React.ReactElement {
  const [dragState, setDragState] = useState<DragState>(createInitialDragState);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const cardId = String(event.active.id);
      const card = links[cardId];
      if (!card) return;
      setDragState({
        draggingCard: card,
        sourceColumn: card.column,
        mergeTargetId: null,
        reorderTargetId: null,
        reorderAbove: true,
      });
    },
    [links],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (!over) {
        setDragState((prev) => ({
          ...prev,
          mergeTargetId: null,
          reorderTargetId: null,
        }));
        return;
      }

      const overId = String(over.id);
      const overData = over.data.current;

      // If hovering over a card (potential merge or reorder)
      if (overData?.type === 'card') {
        const sourceCard = dragState.draggingCard;
        const targetCard = links[overId];

        if (sourceCard && targetCard && sourceCard.id !== targetCard.id) {
          const isSameColumn = sourceCard.column === targetCard.column;

          if (isSameColumn) {
            // Same column: reorder
            setDragState((prev) => ({
              ...prev,
              mergeTargetId: null,
              reorderTargetId: overId,
              // Determine above/below based on sort order
              reorderAbove: true,
            }));
          } else {
            // Cross column: merge if allowed
            const blocked = mergeBlocked(sourceCard, targetCard);
            if (!blocked) {
              setDragState((prev) => ({
                ...prev,
                mergeTargetId: overId,
                reorderTargetId: null,
              }));
            } else {
              setDragState((prev) => ({
                ...prev,
                mergeTargetId: null,
                reorderTargetId: null,
              }));
            }
          }
        }
      } else {
        // Hovering over a column droppable
        setDragState((prev) => ({
          ...prev,
          mergeTargetId: null,
          reorderTargetId: null,
        }));
      }
    },
    [dragState.draggingCard, links],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const sourceCard = dragState.draggingCard;

      // Reset drag state
      setDragState(createInitialDragState());

      if (!sourceCard || !over) return;

      const overId = String(over.id);
      const overData = over.data.current;

      // Merge onto a card
      if (dragState.mergeTargetId) {
        const targetCard = links[dragState.mergeTargetId];
        if (targetCard && mergeBlocked(sourceCard, targetCard) === null) {
          onMergeCards(sourceCard.id, dragState.mergeTargetId);
          return;
        }
      }

      // Reorder within same column
      if (
        dragState.reorderTargetId &&
        dragState.sourceColumn &&
        overData?.type === 'card'
      ) {
        const targetId = dragState.reorderTargetId;
        if (targetId !== sourceCard.id) {
          onReorderCard(sourceCard.id, targetId, dragState.reorderAbove);
          return;
        }
      }

      // Column move
      if (overData?.type === 'column') {
        const targetColumn = overData.column as KanbanCodeColumn;
        if (targetColumn && targetColumn !== sourceCard.column) {
          onMoveCard(String(active.id), targetColumn);
        }
      }
    },
    [
      dragState.draggingCard,
      dragState.mergeTargetId,
      dragState.reorderTargetId,
      dragState.sourceColumn,
      dragState.reorderAbove,
      links,
      onMoveCard,
      onMergeCards,
      onReorderCard,
    ],
  );

  const contextValue = useMemo(() => ({ dragState }), [dragState]);

  return (
    <DragContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {dragState.draggingCard ? (
            <div
              style={{
                padding: 10,
                backgroundColor: 'rgba(255,255,255,0.95)',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                maxWidth: 280,
                fontSize: 14,
                fontWeight: 500,
                opacity: 0.9,
              }}
            >
              {dragState.draggingCard.name ?? dragState.draggingCard.id}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </DragContext.Provider>
  );
}
