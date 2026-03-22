import { create } from 'zustand';
import type { Link, KanbanCodeColumn, SSEEventData, StateSnapshot } from '@kanban-code/shared';

/**
 * Client-side Zustand store — applies SSE events from server.
 * No reconciliation logic. Pure view state.
 *
 * Spec: Section 5.2 (Client-Side Store)
 */

interface BoardState {
  links: Record<string, Link>;
  selectedCardId: string | null;
  selectedProjectPath: string | null;
  selectedProjectPaths: string[];
  paletteOpen: boolean;
  detailExpanded: boolean;
  boardViewMode: 'kanban' | 'list';
  error: string | null;
  isLoading: boolean;
  isConnected: boolean;
  backendUrl: string;

  selectedCardIds: Set<string>;
  selectedAssistant: string | null;
  selectedAssistants: string[];
  selectedCardType: 'all' | 'sessions' | 'tasks' | 'issues';
  selectedCardTypes: string[];

  pendingOps: Record<string, { type: string; label: string }>;
  setPendingOp: (cardId: string, op: { type: string; label: string }) => void;
  clearPendingOp: (cardId: string) => void;

  setBackendUrl: (url: string) => void;

  // Actions
  selectCard: (cardId: string | null) => void;
  toggleCardSelection: (cardId: string) => void;
  selectAllInColumn: (cardIds: string[]) => void;
  deselectAllInColumn: (cardIds: string[]) => void;
  clearSelection: () => void;
  setSelectedProjectPath: (path: string | null) => void;
  toggleProjectPath: (path: string) => void;
  setSelectedAssistant: (assistant: string | null) => void;
  toggleAssistant: (assistant: string) => void;
  setSelectedCardType: (cardType: 'all' | 'sessions' | 'tasks' | 'issues') => void;
  toggleCardType: (type: string) => void;
  clearFilters: () => void;
  setPaletteOpen: (open: boolean) => void;
  setDetailExpanded: (expanded: boolean) => void;
  setBoardViewMode: (mode: 'kanban' | 'list') => void;
  setError: (error: string | null) => void;
  setConnected: (connected: boolean) => void;

  // SSE event handlers
  applySnapshot: (data: { state?: Partial<StateSnapshot>; links?: Record<string, Link> }) => void;
  applyEvent: (event: string, data: SSEEventData) => void;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  links: {},
  selectedCardId: null,
  selectedProjectPath: localStorage.getItem('selectedProjectPath') ?? null,
  paletteOpen: false,
  detailExpanded: false,
  boardViewMode: (localStorage.getItem('boardViewMode') as 'kanban' | 'list') ?? 'kanban',
  error: null,
  isLoading: false,
  isConnected: false,
  backendUrl: localStorage.getItem('backendUrl') ?? '',
  selectedCardIds: new Set<string>(),
  selectedAssistant: localStorage.getItem('selectedAssistant') ?? null,
  selectedAssistants: JSON.parse(localStorage.getItem('selectedAssistants') ?? '[]'),
  selectedCardType: (localStorage.getItem('selectedCardType') as 'all' | 'sessions' | 'tasks' | 'issues') ?? 'all',
  selectedCardTypes: JSON.parse(localStorage.getItem('selectedCardTypes') ?? '[]'),
  selectedProjectPaths: JSON.parse(localStorage.getItem('selectedProjectPaths') ?? '[]'),

  pendingOps: {},
  setPendingOp: (cardId, op) => set(state => ({
    pendingOps: { ...state.pendingOps, [cardId]: op },
  })),
  clearPendingOp: (cardId) => set(state => {
    const { [cardId]: _, ...rest } = state.pendingOps;
    return { pendingOps: rest };
  }),

  selectCard: (cardId) => set({ selectedCardId: cardId }),
  toggleCardSelection: (cardId: string) => {
    const current = get().selectedCardIds;
    const next = new Set(current);
    if (next.has(cardId)) {
      next.delete(cardId);
    } else {
      next.add(cardId);
    }
    set({ selectedCardIds: next });
  },

  selectAllInColumn: (cardIds: string[]) => {
    const next = new Set(get().selectedCardIds);
    for (const id of cardIds) next.add(id);
    set({ selectedCardIds: next });
  },

  deselectAllInColumn: (cardIds: string[]) => {
    const next = new Set(get().selectedCardIds);
    for (const id of cardIds) next.delete(id);
    set({ selectedCardIds: next });
  },

  clearSelection: () => {
    set({ selectedCardIds: new Set<string>() });
  },
  setSelectedProjectPath: (path) => {
    if (path) localStorage.setItem('selectedProjectPath', path);
    else localStorage.removeItem('selectedProjectPath');
    set({ selectedProjectPath: path });
  },
  toggleProjectPath: (path) => {
    const current = get().selectedProjectPaths;
    const next = current.includes(path) ? current.filter(p => p !== path) : [...current, path];
    localStorage.setItem('selectedProjectPaths', JSON.stringify(next));
    set({ selectedProjectPaths: next });
  },
  setSelectedAssistant: (assistant) => {
    if (assistant) localStorage.setItem('selectedAssistant', assistant);
    else localStorage.removeItem('selectedAssistant');
    set({ selectedAssistant: assistant });
  },
  toggleAssistant: (assistant) => {
    const current = get().selectedAssistants;
    const next = current.includes(assistant) ? current.filter(a => a !== assistant) : [...current, assistant];
    localStorage.setItem('selectedAssistants', JSON.stringify(next));
    set({ selectedAssistants: next });
  },
  setSelectedCardType: (cardType) => {
    if (cardType !== 'all') localStorage.setItem('selectedCardType', cardType);
    else localStorage.removeItem('selectedCardType');
    set({ selectedCardType: cardType });
  },
  toggleCardType: (type) => {
    const current = get().selectedCardTypes;
    const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type];
    localStorage.setItem('selectedCardTypes', JSON.stringify(next));
    set({ selectedCardTypes: next });
  },
  clearFilters: () => {
    localStorage.removeItem('selectedProjectPaths');
    localStorage.removeItem('selectedAssistants');
    localStorage.removeItem('selectedCardTypes');
    localStorage.removeItem('selectedProjectPath');
    localStorage.removeItem('selectedAssistant');
    localStorage.removeItem('selectedCardType');
    set({
      selectedProjectPaths: [], selectedAssistants: [], selectedCardTypes: [],
      selectedProjectPath: null, selectedAssistant: null, selectedCardType: 'all',
    });
  },
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setDetailExpanded: (expanded) => set({ detailExpanded: expanded }),
  setBoardViewMode: (mode) => {
    localStorage.setItem('boardViewMode', mode);
    set({ boardViewMode: mode });
  },
  setError: (error) => set({ error }),
  setConnected: (connected) => set({ isConnected: connected }),
  setBackendUrl: (url) => {
    localStorage.setItem('backendUrl', url);
    set({ backendUrl: url });
  },

  applySnapshot: (data) => {
    set({
      links: data.state?.links ?? data.links ?? {},
      isLoading: false,
    });
  },

  applyEvent: (event, data) => {
    // Handle spec-defined SSE event names (Section 3.2)
    switch (event) {
      case 'card:updated':
      case 'card:deleted':
      case 'cards:reordered':
      case 'cards:reconciled':
      case 'launch:completed':
      case 'launch:failed':
      case 'resume:completed':
      case 'resume:failed':
      case 'terminal:created':
      case 'terminal:failed':
        if (data?.state?.links) {
          const newLinks = data.state.links;
          const currentSelection = get().selectedCardIds;
          if (currentSelection.size > 0) {
            const pruned = new Set([...currentSelection].filter(id => id in newLinks));
            if (pruned.size !== currentSelection.size) {
              set({ links: newLinks, selectedCardIds: pruned });
            } else {
              set({ links: newLinks });
            }
          } else {
            set({ links: newLinks });
          }
        }
        if (data?.state?.error !== undefined) set({ error: data.state.error ?? null });
        break;
      case 'activity:changed':
        // Phase 2: update activityMap in store
        break;
      case 'error':
        if (data?.state?.error !== undefined) set({ error: data.state.error ?? null });
        break;
      case 'loading':
        // Phase 2: set isLoading
        break;
      default:
        // Fallback: apply any state fields present
        if (data?.state?.links) set({ links: data.state.links });
        if (data?.state?.error !== undefined) set({ error: data.state.error ?? null });
        break;
    }
  },
}));

// Helper: get cards in a specific column, filtered by project, sorted
export function getCardsInColumn(
  links: Record<string, Link>,
  column: KanbanCodeColumn,
  projectPath?: string | null,
  assistant?: string | null,
  cardType?: 'all' | 'sessions' | 'tasks' | 'issues',
  projectPaths?: string[],
  assistants?: string[],
  cardTypes?: string[],
): Link[] {
  return Object.values(links)
    .filter(l => l.column === column)
    .filter(l => {
      if (projectPaths?.length) return projectPaths.includes(l.projectPath ?? '');
      return !projectPath || l.projectPath === projectPath;
    })
    .filter(l => {
      if (assistants?.length) return assistants.includes(l.assistant ?? l.effectiveAssistant ?? '');
      return !assistant || l.assistant === assistant;
    })
    .filter(l => {
      if (cardTypes?.length) return cardTypes.includes(l.cardType ?? '');
      if (!cardType || cardType === 'all') return true;
      return l.cardType === cardType;
    })
    .sort((a, b) => {
      const aOrder = a.sortOrder ?? 999999;
      const bOrder = b.sortOrder ?? 999999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const tb = String(b.updatedAt ?? '');
      const ta = String(a.updatedAt ?? '');
      return tb.localeCompare(ta);
    });
}
