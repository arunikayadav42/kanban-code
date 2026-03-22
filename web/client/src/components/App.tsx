/**
 * App -- the root component that wires everything together.
 *
 * Swift source: Sources/KanbanCode/ContentView.swift
 *
 * Layout:
 * - Toolbar: project selector, board mode toggle, refresh, process manager, settings, new task
 * - Body: BoardView or ListBoardView based on boardViewMode
 * - Right panel: CardDetailView when selectedCardId is set (resizable inspector)
 * - Overlays: SearchOverlay, NewTaskDialog, LaunchConfirmationDialog, SettingsView, ProcessManagerView
 * - Connects useSSE hook to Zustand store
 * - Error banner at bottom
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useBoardStore } from '../store/index.js';
import { useSSE } from '../hooks/useSSE.js';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';
import type { ShortcutContext } from '../hooks/useKeyboardShortcuts.js';
import { api, getApiBase } from '../lib/api-client.js';
import BoardView from './BoardView.js';
import ListBoardView from './ListBoardView.js';
import CardDetailView, { getInitialTab } from './CardDetailView.js';
import type { DetailTab } from './CardDetailView.js';
import NewTaskDialog from './NewTaskDialog.js';
import ProcessManagerView from './ProcessManagerView.js';
import SettingsView from './SettingsView.js';
import SearchOverlay from './SearchOverlay.js';
import type { CommandItem } from './SearchOverlay.js';
import OnboardingWizard from './OnboardingWizard.js';
import BulkConfirmDialog from './BulkConfirmDialog.js';
import Toast from './Toast.js';
import type { Project, Link, KanbanCodeColumn, CodingAssistant } from '@kanban-code/shared';
import { getDisplayTitle, getShortDisplayName, getColumnDisplayName } from '@kanban-code/shared';
import type { AppearanceMode } from '../lib/theme.js';
import { getNextMode, getModeIcon, getModeLabel, applyTheme } from '../lib/theme.js';

// MARK: - Component

export default function App(): React.ReactElement {
  // Store
  const links = useBoardStore((s) => s.links);
  const selectedCardId = useBoardStore((s) => s.selectedCardId);
  const paletteOpen = useBoardStore((s) => s.paletteOpen);
  const detailExpanded = useBoardStore((s) => s.detailExpanded);
  const boardViewMode = useBoardStore((s) => s.boardViewMode);
  const error = useBoardStore((s) => s.error);
  const isConnected = useBoardStore((s) => s.isConnected);

  const selectCard = useBoardStore((s) => s.selectCard);
  const setPaletteOpen = useBoardStore((s) => s.setPaletteOpen);
  const setDetailExpanded = useBoardStore((s) => s.setDetailExpanded);
  const setBoardViewMode = useBoardStore((s) => s.setBoardViewMode);
  const setError = useBoardStore((s) => s.setError);
  const setConnected = useBoardStore((s) => s.setConnected);
  const applySnapshot = useBoardStore((s) => s.applySnapshot);
  const applyEvent = useBoardStore((s) => s.applyEvent);

  const pendingOps = useBoardStore((s) => s.pendingOps);
  const setPendingOp = useBoardStore((s) => s.setPendingOp);
  const clearPendingOp = useBoardStore((s) => s.clearPendingOp);
  const clearSelection = useBoardStore((s) => s.clearSelection);
  const selectedAssistant = useBoardStore((s) => s.selectedAssistant);
  const setSelectedAssistant = useBoardStore((s) => s.setSelectedAssistant);
  const selectedCardType = useBoardStore((s) => s.selectedCardType);
  const setSelectedCardType = useBoardStore((s) => s.setSelectedCardType);
  const selectedProjectPaths = useBoardStore((s) => s.selectedProjectPaths);
  const toggleProjectPath = useBoardStore((s) => s.toggleProjectPath);
  const selectedAssistants = useBoardStore((s) => s.selectedAssistants);
  const toggleAssistant = useBoardStore((s) => s.toggleAssistant);
  const selectedCardTypes = useBoardStore((s) => s.selectedCardTypes);
  const toggleCardType = useBoardStore((s) => s.toggleCardType);
  const clearFilters = useBoardStore((s) => s.clearFilters);

  // Local state
  const [showNewTask, setShowNewTask] = useState(false);
  const [bulkAction, setBulkAction] = useState<{ type: 'archive' | 'resume' | 'delete' | 'moveProject'; cardIds: string[]; projectPath?: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showProcessManager, setShowProcessManager] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [configuredProjects, setConfiguredProjects] = useState<Project[]>([]);
  const [serverAssistants, setServerAssistants] = useState<Array<{ id: string; shortName: string; displayName: string; available: boolean }>>([]);

  // Projects come from /api/projects (configured + auto-discovered, hidden filtered out)
  const projects: Project[] = configuredProjects;
  const selectedProjectPath = useBoardStore((s) => s.selectedProjectPath);
  const setSelectedProjectPath = useBoardStore((s) => s.setSelectedProjectPath);
  const [detailTab, setDetailTab] = useState<DetailTab>('terminal');
  const [turns, setTurns] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [detailWidth, setDetailWidth] = useState(() => Math.round(window.innerWidth / 2));
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(
    () => (localStorage.getItem('appearanceMode') as AppearanceMode) ?? 'auto'
  );

  // Apply theme on mount and when mode changes
  useEffect(() => {
    applyTheme(appearanceMode);
    localStorage.setItem('appearanceMode', appearanceMode);
    // Listen for system theme changes in auto mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (appearanceMode === 'auto') applyTheme('auto'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [appearanceMode]);

  // Clear selection when project filter changes
  useEffect(() => {
    clearSelection();
  }, [selectedProjectPath, clearSelection]);

  useEffect(() => {
    clearSelection();
  }, [selectedAssistant, clearSelection]);

  useEffect(() => {
    clearSelection();
  }, [selectedCardType, clearSelection]);

  // Derived — memoize selectedCard to prevent terminal remount on every SSE update
  const selectedCardRef = useRef<Link | null>(null);
  const selectedCard = useMemo(() => {
    const card = selectedCardId ? links[selectedCardId] ?? null : null;
    if (!card) { selectedCardRef.current = null; return null; }
    // Only return a new reference if the card actually changed
    const prev = selectedCardRef.current;
    if (prev && prev.id === card.id && prev.updatedAt === card.updatedAt && prev.column === card.column
        && JSON.stringify(prev.tmuxLink) === JSON.stringify(card.tmuxLink)
        && JSON.stringify(prev.sessionLink) === JSON.stringify(card.sessionLink)) {
      return prev; // Same reference — prevents re-render
    }
    selectedCardRef.current = card;
    return card;
  }, [selectedCardId, links]);
  const detailOpen = selectedCard !== null;

  // DEBUG: trace card selection
  useEffect(() => {
    const tmux = selectedCard?.tmuxLink?.sessionName ?? 'none';
    const session = selectedCard?.sessionLink?.sessionId?.substring(0, 8) ?? 'none';
    fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(
      `SELECT cardId=${selectedCardId} found=${!!selectedCard} tmux=${tmux} session=${session} tab=${detailTab}`
    )}`).catch(() => {});
  }, [selectedCardId]);

  // MARK: - SSE Connection

  useSSE({
    onConnect: () => setConnected(true),
    onError: () => setConnected(false),
    onEvent: (event, data) => {
      fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(`SSE event=${event} hasLinks=${!!(data as any)?.state?.links}`)}`).catch(() => {});
      if (event === 'state:snapshot') {
        applySnapshot(data);
      } else {
        applyEvent(event, data);
      }
    },
  });

  // MARK: - Load projects on mount

  useEffect(() => {
    api.getProjects()
      .then((res) => setConfiguredProjects(res.projects))
      .catch(() => { /* projects optional */ });
    Promise.all([api.getAssistants(), api.getHealth()])
      .then(([assistRes, healthRes]) => {
        const availability = (healthRes as any).dependencies?.assistantAvailability ?? {};
        setServerAssistants(((assistRes as any).assistants ?? []).map((a: any) => ({
          id: a.id, shortName: a.shortName, displayName: a.displayName,
          available: !!availability[a.id],
        })));
      })
      .catch(() => {});
    // Check if onboarding needed — Swift: ContentView.swift:895-897
    api.getSettings()
      .then((settings: any) => {
        if (settings && !settings.hasCompletedOnboarding) {
          setShowOnboarding(true);
        }
      })
      .catch(() => { /* settings optional */ });
  }, []);

  // MARK: - Update detail tab when card selection changes

  useEffect(() => {
    if (selectedCard) {
      setDetailTab(getInitialTab(selectedCard));
      // Fetch session history — Swift: CardDetailView.swift loadHistory()
      if (selectedCard.sessionLink?.sessionId) {
        setIsLoadingHistory(true);
        setTurns([]);
        api.getCardHistory(selectedCard.id)
          .then((res) => setTurns(res.turns))
          .catch(() => setTurns([]))
          .finally(() => setIsLoadingHistory(false));
      } else {
        setTurns([]);
      }
    } else {
      setTurns([]);
    }
  }, [selectedCardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // MARK: - Keyboard shortcuts

  const shortcutContext: ShortcutContext = {
    paletteOpen,
    detailOpen,
    expandedDetail: detailExpanded,
    terminalTabActive: detailTab === 'terminal',
  };

  useKeyboardShortcuts(shortcutContext, {
    onTogglePalette: useCallback(() => setPaletteOpen(!paletteOpen), [paletteOpen, setPaletteOpen]),
    onOpenCommandMode: useCallback(() => {
      setPaletteOpen(true);
      // command mode: future implementation will set initial query to ">"
    }, [setPaletteOpen]),
    onToggleExpanded: useCallback(() => setDetailExpanded(!detailExpanded), [detailExpanded, setDetailExpanded]),
    onDeepSearch: useCallback(() => {
      // Future: trigger deep search in palette
    }, []),
    onNewTerminal: useCallback(() => {
      // Future: create extra terminal for selected card
    }, []),
    onNewTask: useCallback(() => setShowNewTask(true), []),
    onSwitchProject: useCallback((index: number) => {
      if (index < projects.length) {
        setSelectedProjectPath(projects[index].path);
      }
    }, [projects]),
    onDeselect: useCallback(() => {
      if (paletteOpen) {
        setPaletteOpen(false);
      } else {
        selectCard(null);
      }
    }, [paletteOpen, setPaletteOpen, selectCard]),
    onDeleteCard: useCallback(() => {
      if (selectedCardId) {
        api.deleteCard(selectedCardId).catch((err) => {
          setError(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
        });
      }
    }, [selectedCardId, setError]),
  });

  // MARK: - Card operations

  const handleCreateTask = useCallback(
    async (params: { prompt: string; projectPath: string | null; title: string | null; assistant?: string }) => {
      try {
        await api.createCard({
          name: params.title ?? params.prompt.slice(0, 80),
          promptBody: params.prompt,
          projectPath: params.projectPath ?? undefined,
          assistant: (params.assistant as any) ?? undefined,
        });
      } catch (err) {
        setError(`Failed to create task: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [setError],
  );

  const handleCreateAndLaunch = useCallback(
    async (params: {
      prompt: string;
      projectPath: string | null;
      title: string | null;
      createWorktree: boolean;
      runRemotely: boolean;
      skipPermissions: boolean;
      commandOverride: string | null;
      assistant: string;
    }) => {
      try {
        const card = await api.createCard({
          name: params.title ?? params.prompt.slice(0, 80),
          promptBody: params.prompt,
          projectPath: params.projectPath ?? undefined,
          assistant: (params.assistant as any) ?? undefined,
        });
        await api.launchCard(card.id, {
          prompt: params.prompt,
          projectPath: params.projectPath ?? '/tmp',
          skipPermissions: params.skipPermissions,
        });
      } catch (err) {
        setError(`Failed to create & launch: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [setError],
  );

  const handleStartCard = useCallback(
    async (cardId: string) => {
      const card = links[cardId];
      if (!card) return;
      try {
        await api.launchCard(cardId, {
          prompt: card.promptBody ?? card.name ?? '',
          projectPath: card.projectPath ?? '/tmp',
          skipPermissions: true,
        });
      } catch (err) {
        setError(`Failed to launch: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [links, setError],
  );

  const handleResumeCard = useCallback(
    async (cardId: string) => {
      try {
        await api.resumeCard(cardId);
      } catch (err) {
        setError(`Failed to resume: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [setError],
  );

  const handleDeleteCard = useCallback(
    async (cardId: string) => {
      try {
        await api.deleteCard(cardId);
      } catch (err) {
        setError(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [setError],
  );

  const handleArchiveCard = useCallback(
    async (cardId: string) => {
      try {
        await api.archiveCard(cardId);
      } catch (err) {
        setError(`Failed to archive: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [setError],
  );

  const handleBulkArchive = useCallback((cardIds: string[]) => {
    setBulkAction({ type: 'archive', cardIds });
  }, []);

  const handleBulkResume = useCallback((cardIds: string[]) => {
    setBulkAction({ type: 'resume', cardIds });
  }, []);

  const handleBulkDelete = useCallback((cardIds: string[]) => {
    setBulkAction({ type: 'delete', cardIds });
  }, []);

  const handleBulkMoveProject = useCallback((cardIds: string[], projectPath: string) => {
    setBulkAction({ type: 'moveProject', cardIds, projectPath });
  }, []);

  const handleBulkConfirm = useCallback(async () => {
    if (!bulkAction) return;
    try {
      if (bulkAction.type === 'archive') {
        await api.bulkArchive(bulkAction.cardIds);
      } else if (bulkAction.type === 'resume') {
        await api.bulkResume(bulkAction.cardIds);
      } else if (bulkAction.type === 'delete') {
        await api.bulkDelete(bulkAction.cardIds);
      } else if (bulkAction.type === 'moveProject' && bulkAction.projectPath) {
        await api.bulkMoveProject(bulkAction.cardIds, bulkAction.projectPath);
      }
      clearSelection();
      const label = bulkAction.type === 'archive' ? 'Archived' : bulkAction.type === 'resume' ? 'Resumed' : bulkAction.type === 'delete' ? 'Deleted' : 'Moved';
      setToastMessage(`${label} ${bulkAction.cardIds.length} cards`);
    } catch (err) {
      setError(`Bulk operation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setBulkAction(null);
  }, [bulkAction, clearSelection, setError]);

  const handleForkCard = useCallback(
    async (cardId: string) => {
      setPendingOp(cardId, { type: 'fork', label: 'Forking session...' });
      try {
        await api.forkCard(cardId);
        setToastMessage('Session forked');
      } catch (err) {
        setToastMessage(`Fork failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        clearPendingOp(cardId);
      }
    },
    [setPendingOp, clearPendingOp],
  );

  const handleMoveCard = useCallback(
    async (cardId: string, column: KanbanCodeColumn) => {
      setPendingOp(cardId, { type: 'move', label: `Moving to ${getColumnDisplayName(column)}...` });
      try {
        await api.updateCard(cardId, { column });
      } catch (err) {
        setToastMessage(err instanceof Error ? err.message : 'Move failed');
      } finally {
        clearPendingOp(cardId);
      }
    },
    [setPendingOp, clearPendingOp],
  );

  const handleRenameCard = useCallback(
    async (cardId: string) => {
      const card = links[cardId];
      const newName = prompt('Rename card:', card?.name ?? getDisplayTitle(card));
      if (newName === null) return; // cancelled
      try {
        await api.updateCard(cardId, { name: newName });
      } catch (err) {
        setError(`Failed to rename: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [links, setError],
  );

  const handleRefresh = useCallback(() => {
    fetch(`${getApiBase()}/backlog/refresh`, { method: 'POST' }).catch(() => {});
    api.getCards()
      .then((res) => {
        const linkMap: Record<string, typeof res.cards[0]> = {};
        for (const c of res.cards) linkMap[c.id] = c;
        applySnapshot({ links: linkMap });
        setToastMessage(`Refreshed — ${res.cards.length} cards`);
      })
      .catch((err) => {
        setError(`Refresh failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });
  }, [applySnapshot, setError]);

  const handleRediscover = useCallback(async () => {
    try {
      const result = await api.rediscover();
      const res = await api.getCards();
      const linkMap: Record<string, typeof res.cards[0]> = {};
      for (const c of res.cards) linkMap[c.id] = c;
      applySnapshot({ links: linkMap });
      setToastMessage(`Rediscovered — wiped ${result.wiped} cards, kept ${result.kept}, found ${res.cards.length} total`);
    } catch (err) {
      setError(`Rediscovery failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [applySnapshot, setError]);

  // MARK: - Resizable detail panel

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: detailWidth };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - moveEvent.clientX;
      const newWidth = Math.max(350, Math.min(1200, resizeRef.current.startWidth + delta));
      setDetailWidth(newWidth);
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [detailWidth]);

  // MARK: - Render

  return (
    <div data-testid="app-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary, #0a0a0c)', color: 'var(--text-primary, #e4e4e7)' }}>
      {/* Toolbar */}
      <div data-testid="toolbar" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-primary, #222)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* Project filter dropdown */}
        {projects.length > 0 && (
          <ChecklistDropdown
            label="Projects"
            items={projects.map(p => ({ id: p.path, label: p.name }))}
            selected={selectedProjectPaths}
            onToggle={toggleProjectPath}
          />
        )}

        {/* Assistant filter dropdown */}
        {serverAssistants.length > 0 && (
          <ChecklistDropdown
            label="Assistants"
            items={serverAssistants.map(a => ({ id: a.id, label: `${a.shortName}${a.available ? '' : ' (n/a)'}` }))}
            selected={selectedAssistants}
            onToggle={toggleAssistant}
          />
        )}

        {/* Card type filter dropdown */}
        <ChecklistDropdown
          label="Types"
          items={[
            { id: 'sessions', label: 'Sessions' },
            { id: 'tasks', label: 'Tasks' },
            { id: 'issues', label: 'Issues' },
          ]}
          selected={selectedCardTypes}
          onToggle={toggleCardType}
        />

        {/* Clear filters */}
        {(selectedProjectPaths.length > 0 || selectedAssistants.length > 0 || selectedCardTypes.length > 0) && (
          <button
            data-testid="clear-filters"
            onClick={clearFilters}
            style={{
              padding: '3px 8px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
              backgroundColor: 'transparent', border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)',
            }}
          >
            Clear
          </button>
        )}

        {/* Connection indicator */}
        <span data-testid="connection-status" style={{ fontSize: 12, opacity: 0.5 }}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>

        <span style={{ flex: 1 }} />

        {/* Sync button */}
        <button
          data-testid="btn-sync"
          onClick={async () => {
            try {
              await api.sync();
              setToastMessage('Sync complete');
            } catch { setToastMessage('Sync failed'); }
          }}
          title="Sync sessions, PRs & worktrees"
          style={toolbarBtnStyle}
        >
          Sync
        </button>

        {/* Search button */}
        <button
          data-testid="btn-search"
          onClick={() => setPaletteOpen(true)}
          title="Search (Cmd+K)"
          style={toolbarBtnStyle}
        >
          Search
        </button>

        {/* Board view mode toggle */}
        <div data-testid="view-mode-toggle" style={{ display: 'flex', gap: 2, background: 'var(--bg-input)', borderRadius: 6, padding: 2 }}>
          <button
            data-testid="mode-kanban"
            onClick={() => setBoardViewMode('kanban')}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              background: boardViewMode === 'kanban' ? 'var(--bg-tertiary)' : 'transparent',
              color: boardViewMode === 'kanban' ? '#fff' : '#888',
            }}
          >
            Board
          </button>
          <button
            data-testid="mode-list"
            onClick={() => setBoardViewMode('list')}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              background: boardViewMode === 'list' ? 'var(--bg-tertiary)' : 'transparent',
              color: boardViewMode === 'list' ? '#fff' : '#888',
            }}
          >
            List
          </button>
        </div>

        {/* Theme toggle — cycles auto → dark → light (matches Swift AppearanceMode) */}
        <button
          data-testid="btn-theme"
          onClick={() => setAppearanceMode(getNextMode(appearanceMode))}
          title={`Appearance: ${getModeLabel(appearanceMode)}`}
          style={toolbarBtnStyle}
        >
          {getModeIcon(appearanceMode)}
        </button>

        {/* Refresh button */}
        <button
          data-testid="btn-refresh"
          onClick={handleRefresh}
          title="Refresh board"
          style={toolbarBtnStyle}
        >
          Refresh
        </button>

        <button
          data-testid="btn-rediscover"
          onClick={handleRediscover}
          title="Wipe discovered cards and rediscover from disk"
          style={toolbarBtnStyle}
        >
          Rediscover
        </button>

        {/* Process manager button */}
        <button
          data-testid="btn-process-manager"
          onClick={() => setShowProcessManager(true)}
          title="Process Manager"
          style={toolbarBtnStyle}
        >
          Processes
        </button>

        {/* Settings button */}
        <button
          data-testid="btn-settings"
          onClick={() => setShowSettings(true)}
          title="Settings"
          style={toolbarBtnStyle}
        >
          Settings
        </button>

        {/* New task button */}
        <button
          data-testid="btn-new-task"
          onClick={() => setShowNewTask(true)}
          title="New Task (Cmd+N)"
          style={{
            ...toolbarBtnStyle,
            backgroundColor: '#4f8ef7',
            color: '#fff',
          }}
        >
          + New Task
        </button>
      </div>

      {/* Body: Board + Detail panel */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Board */}
        <div data-testid="board-container" style={{ flex: 1, overflow: 'auto' }}>
          {boardViewMode === 'kanban' ? (
            <BoardView
              onStartCard={handleStartCard}
              onResumeCard={handleResumeCard}
              onForkCard={handleForkCard}
              onRenameCard={handleRenameCard}
              onArchiveCard={handleArchiveCard}
              onDeleteCard={handleDeleteCard}
              onMoveCard={handleMoveCard}
              onNewTask={() => setShowNewTask(true)}
              onRefreshBacklog={handleRefresh}
              availableProjects={projects}
              onBulkArchive={handleBulkArchive}
              onBulkResume={handleBulkResume}
              onBulkDelete={handleBulkDelete}
              onBulkMoveProject={handleBulkMoveProject}
              pendingOps={pendingOps}
            />
          ) : (
            <ListBoardView
              onStartCard={handleStartCard}
              onResumeCard={handleResumeCard}
              onArchiveCard={handleArchiveCard}
              onDeleteCard={handleDeleteCard}
              onMoveCard={handleMoveCard}
              onNewTask={() => setShowNewTask(true)}
              onBulkArchive={handleBulkArchive}
              onBulkResume={handleBulkResume}
              onBulkDelete={handleBulkDelete}
              onBulkMoveProject={handleBulkMoveProject}
              pendingOps={pendingOps}
            />
          )}
        </div>

        {/* Detail panel (right inspector) */}
        {selectedCard && (
          <>
            {/* Resize handle */}
            <div
              data-testid="detail-resize-handle"
              onMouseDown={handleResizeStart}
              style={{
                width: 4,
                cursor: 'col-resize',
                background: 'var(--border-primary)',
                flexShrink: 0,
              }}
            />
            <div
              data-testid="detail-panel"
              style={{
                width: detailExpanded ? '100%' : detailWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <ErrorBoundary cardId={selectedCard.id}>
                <CardDetailView
                  link={selectedCard}
                  turns={turns}
                  isLoadingHistory={isLoadingHistory}
                  isExpanded={detailExpanded}
                  onToggleExpand={() => setDetailExpanded(!detailExpanded)}
                  onClose={() => selectCard(null)}
                  onResume={() => {
                    if (selectedCard.sessionLink) {
                      handleResumeCard(selectedCard.id);
                    } else {
                      handleStartCard(selectedCard.id);
                    }
                  }}
                  onAddQueuedPrompt={async (prompt) => {
                    try {
                      await api.addQueuedPrompt(selectedCard.id, prompt.body, prompt.sendAutomatically);
                    } catch (err) {
                      setToastMessage(`Failed to queue prompt: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    }
                  }}
                  onSendQueuedPrompt={async (promptId) => {
                    try {
                      await api.sendQueuedPrompt(selectedCard.id, promptId);
                    } catch (err) {
                      setToastMessage(`Failed to send prompt: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    }
                  }}
                  onRemoveQueuedPrompt={async (promptId) => {
                    try {
                      await api.removeQueuedPrompt(selectedCard.id, promptId);
                    } catch (err) {
                      setToastMessage(`Failed to remove prompt: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    }
                  }}
                />
              </ErrorBoundary>
            </div>
          </>
        )}
      </div>

      {/* Search overlay (Cmd+K in native — here triggered by toolbar button) */}
      <SearchOverlay
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        cards={Object.values(links)}
        onSelectCard={(card) => {
          selectCard(card.id);
          setPaletteOpen(false);
        }}
        commands={[
          { id: 'new-task', title: 'New Task', icon: '✚', shortcut: '', action: () => { setPaletteOpen(false); setShowNewTask(true); } },
          { id: 'settings', title: 'Open Settings', icon: '⚙', shortcut: '', action: () => { setPaletteOpen(false); setShowSettings(true); } },
          { id: 'processes', title: 'Process Manager', icon: '⚡', shortcut: '', action: () => { setPaletteOpen(false); setShowProcessManager(true); } },
          { id: 'refresh', title: 'Refresh Board', icon: '↺', shortcut: '', action: () => { setPaletteOpen(false); handleRefresh(); } },
        ]}
      />

      {/* Overlays */}
      <NewTaskDialog
        isOpen={showNewTask}
        onClose={() => setShowNewTask(false)}
        projects={projects}
        defaultProjectPath={selectedProjectPath}
        enabledAssistants={serverAssistants.length > 0
          ? serverAssistants.filter(a => a.available).map(a => a.id as CodingAssistant)
          : undefined}
        onCreate={(params) => {
          handleCreateTask(params);
        }}
        onCreateAndLaunch={(params) => {
          handleCreateAndLaunch(params);
        }}
      />

      {/* Process Manager modal */}
      {showProcessManager && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowProcessManager(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 700, height: '80vh', display: 'flex', flexDirection: 'column',
            background: 'var(--bg-secondary, #1c1c1e)', borderRadius: 12,
            border: '1px solid var(--border-primary, #333)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}>
            <ErrorBoundary cardId="process-manager">
              <ProcessManagerView onClose={() => setShowProcessManager(false)} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowSettings(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 700, height: '85vh', display: 'flex', flexDirection: 'column',
            background: 'var(--bg-secondary, #1c1c1e)', borderRadius: 12,
            border: '1px solid var(--border-primary, #333)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}>
            <SettingsView onClose={() => {
              setShowSettings(false);
              // Re-fetch projects in case user hid/unhid any
              api.getProjects().then((res) => setConfiguredProjects(res.projects)).catch(() => {});
            }} />
          </div>
        </div>
      )}

      {/* Onboarding wizard — shown on first launch when hasCompletedOnboarding=false */}
      {showOnboarding && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 600, maxHeight: '85vh', overflow: 'auto',
            background: 'var(--bg-secondary, #1c1c1e)', borderRadius: 12,
            border: '1px solid var(--border-primary, #333)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <OnboardingWizard onComplete={() => {
              setShowOnboarding(false);
              api.patchSettings({ hasCompletedOnboarding: true }).catch(() => {});
            }} />
          </div>
        </div>
      )}

      <BulkConfirmDialog
        isOpen={bulkAction != null}
        title={
          bulkAction?.type === 'archive' ? `Archive ${bulkAction.cardIds.length} cards?` :
          bulkAction?.type === 'resume' ? `Resume ${bulkAction.cardIds.length} cards?` :
          bulkAction?.type === 'delete' ? `Permanently delete ${bulkAction.cardIds.length} cards? This cannot be undone.` :
          bulkAction?.type === 'moveProject' ? `Move ${bulkAction?.cardIds.length} cards?` :
          ''
        }
        cardNames={
          bulkAction?.cardIds.map(id => {
            const link = links[id];
            return link ? (link.name || link.promptBody || link.id).substring(0, 60) : id;
          }) ?? []
        }
        onConfirm={handleBulkConfirm}
        onCancel={() => setBulkAction(null)}
      />

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />

      {/* Error banner */}
      {error && (
        <div
          data-testid="error-banner"
          style={{
            padding: '8px 16px',
            background: '#3b1010',
            color: '#ff6b6b',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button
            data-testid="error-dismiss"
            onClick={() => setError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#ff6b6b',
              cursor: 'pointer',
              fontSize: 16,
              padding: 0,
            }}
          >
            x
          </button>
        </div>
      )}
    </div>
  );
}

// MARK: - Styles

// MARK: - Checklist Dropdown

function ChecklistDropdown({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const count = selected.length;

  useEffect(() => {
    if (!open) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '4px 8px', fontSize: 13, cursor: 'pointer',
          backgroundColor: count > 0 ? 'rgba(0,122,255,0.15)' : 'var(--bg-secondary)',
          border: count > 0 ? '1px solid var(--accent)' : '1px solid var(--border-primary)',
          borderRadius: 6,
          color: count > 0 ? 'var(--accent)' : 'var(--text-primary)',
        }}
      >
        {label}{count > 0 ? ` (${count})` : ''}
        <span style={{ marginLeft: 4, fontSize: 10 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
            backgroundColor: 'var(--menu-bg)', border: '1px solid var(--menu-border)', borderRadius: 8,
            padding: '4px 0', minWidth: 180, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          {/* Select All / Clear */}
          <div style={{ display: 'flex', gap: 4, padding: '4px 12px 6px', borderBottom: '1px solid var(--border-secondary, rgba(255,255,255,0.06))' }}>
            <button
              onClick={() => { for (const item of items) if (!selected.includes(item.id)) onToggle(item.id); }}
              style={{ flex: 1, padding: '3px 0', fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 500 }}
            >
              Select All
            </button>
            <button
              onClick={() => { for (const item of items) if (selected.includes(item.id)) onToggle(item.id); }}
              style={{ flex: 1, padding: '3px 0', fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-secondary)', fontWeight: 500 }}
            >
              Clear
            </button>
          </div>
          {items.map(item => (
            <label
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                color: 'var(--text-primary)',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--menu-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
                style={{ accentColor: '#007AFF' }}
              />
              {item.label}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

// Error boundary to catch CardDetailView crashes and log to server
class ErrorBoundary extends React.Component<
  { cardId: string; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    fetch(`${getApiBase()}/debug?msg=${encodeURIComponent(
      `CRASH cardId=${this.props.cardId} error=${error.message} stack=${(info.componentStack ?? '').slice(0, 300)}`
    )}`).catch(() => {});
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: '#f87171' }}>
          <h3>Detail panel crashed</h3>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
