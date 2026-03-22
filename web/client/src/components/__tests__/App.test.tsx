import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import App from '../App';
import { useBoardStore } from '../../store/index';
import type { Link } from '@kanban-code/shared';
import { createLink } from '@kanban-code/shared';

// MARK: - jsdom polyfills

// App uses window.matchMedia for theme detection
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// MARK: - Mocks

// Mock useSSE to avoid real EventSource
vi.mock('../../hooks/useSSE', () => ({
  useSSE: vi.fn(({ onConnect }: { onConnect?: () => void }) => {
    // Simulate connection on mount
    React.useEffect(() => { onConnect?.(); }, []);
    return { current: null };
  }),
}));

// Mock api-client
vi.mock('../../lib/api-client', () => ({
  api: {
    getCards: vi.fn().mockResolvedValue({ cards: [], total: 0 }),
    createCard: vi.fn().mockResolvedValue({ id: 'new-card', name: 'Test' }),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    archiveCard: vi.fn().mockResolvedValue(undefined),
    launchCard: vi.fn().mockResolvedValue(undefined),
    resumeCard: vi.fn().mockResolvedValue(undefined),
    getProjects: vi.fn().mockResolvedValue({ projects: [] }),
    getSettings: vi.fn().mockResolvedValue({}),
    getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
    cancelLaunch: vi.fn().mockResolvedValue(undefined),
    updateCard: vi.fn().mockResolvedValue(undefined),
  },
  getApiBase: vi.fn().mockReturnValue('/api'),
}));

// Mock child components to isolate App tests
vi.mock('../BoardView', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'board-view', onClick: props.onNewTask as () => void }),
}));

vi.mock('../ListBoardView', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'list-board-view', onClick: props.onNewTask as () => void }),
}));

vi.mock('../CardDetailView', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('div', {
      'data-testid': 'card-detail-view',
      onClick: props.onClose as () => void,
    }),
  getInitialTab: () => 'terminal',
}));

vi.mock('../NewTaskDialog', () => ({
  default: (props: { isOpen: boolean; onClose: () => void }) =>
    props.isOpen
      ? React.createElement('div', {
          'data-testid': 'new-task-dialog-mock',
          onClick: props.onClose,
        }, 'New Task Dialog')
      : null,
}));

// MARK: - Helpers

function makeLink(overrides: Partial<Link> & { id: string }): Link {
  return createLink({
    column: 'backlog',
    source: 'manual',
    projectPath: '/test/project',
    ...overrides,
  });
}

function resetStore(links: Record<string, Link> = {}, extra: Partial<ReturnType<typeof useBoardStore.getState>> = {}) {
  useBoardStore.setState({
    links,
    selectedCardId: null,
    error: null,
    isLoading: false,
    isConnected: false,
    paletteOpen: false,
    detailExpanded: false,
    boardViewMode: 'kanban',
    ...extra,
  });
}

// MARK: - Tests

describe('App', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('Initial render', () => {
    it('renders the app root', () => {
      render(<App />);
      expect(screen.getByTestId('app-root')).toBeDefined();
    });

    it('renders the toolbar', () => {
      render(<App />);
      expect(screen.getByTestId('toolbar')).toBeDefined();
    });

    it('renders the board container', () => {
      render(<App />);
      expect(screen.getByTestId('board-container')).toBeDefined();
    });

    it('shows BoardView by default (kanban mode)', () => {
      render(<App />);
      expect(screen.getByTestId('board-view')).toBeDefined();
    });

    it('shows connection status', async () => {
      render(<App />);
      // onConnect is called, so it should show Connected
      await waitFor(() => {
        expect(screen.getByTestId('connection-status').textContent).toBe('Connected');
      });
    });
  });

  describe('Toolbar actions', () => {
    it('renders new task button', () => {
      render(<App />);
      expect(screen.getByTestId('btn-new-task')).toBeDefined();
    });

    it('opens new task dialog when clicking new task button', () => {
      render(<App />);
      fireEvent.click(screen.getByTestId('btn-new-task'));
      expect(screen.getByTestId('new-task-dialog-mock')).toBeDefined();
    });

    it('renders refresh button', () => {
      render(<App />);
      expect(screen.getByTestId('btn-refresh')).toBeDefined();
    });

    it('renders process manager button', () => {
      render(<App />);
      expect(screen.getByTestId('btn-process-manager')).toBeDefined();
    });

    it('renders settings button', () => {
      render(<App />);
      expect(screen.getByTestId('btn-settings')).toBeDefined();
    });
  });

  describe('Board view mode toggle', () => {
    it('renders view mode toggle', () => {
      render(<App />);
      expect(screen.getByTestId('view-mode-toggle')).toBeDefined();
    });

    it('switches to list view when List button clicked', () => {
      render(<App />);
      fireEvent.click(screen.getByTestId('mode-list'));
      expect(screen.getByTestId('list-board-view')).toBeDefined();
    });

    it('switches back to kanban view when Board button clicked', () => {
      resetStore({}, { boardViewMode: 'list' });
      render(<App />);
      fireEvent.click(screen.getByTestId('mode-kanban'));
      expect(screen.getByTestId('board-view')).toBeDefined();
    });
  });

  describe('Detail panel', () => {
    it('does not show detail panel when no card selected', () => {
      render(<App />);
      expect(screen.queryByTestId('detail-panel')).toBeNull();
    });

    it('shows detail panel when a card is selected', () => {
      const link = makeLink({ id: 'c1', name: 'Test Card' });
      resetStore({ c1: link }, { selectedCardId: 'c1' });
      render(<App />);
      expect(screen.getByTestId('detail-panel')).toBeDefined();
      expect(screen.getByTestId('card-detail-view')).toBeDefined();
    });

    it('shows resize handle when detail panel is open', () => {
      const link = makeLink({ id: 'c1', name: 'Test Card' });
      resetStore({ c1: link }, { selectedCardId: 'c1' });
      render(<App />);
      expect(screen.getByTestId('detail-resize-handle')).toBeDefined();
    });

    it('closes detail panel when close is triggered', () => {
      const link = makeLink({ id: 'c1', name: 'Test Card' });
      resetStore({ c1: link }, { selectedCardId: 'c1' });
      render(<App />);
      // Click the mocked CardDetailView (triggers onClose)
      fireEvent.click(screen.getByTestId('card-detail-view'));
      expect(screen.queryByTestId('detail-panel')).toBeNull();
    });
  });

  describe('Error banner', () => {
    it('does not show error banner when no error', () => {
      render(<App />);
      expect(screen.queryByTestId('error-banner')).toBeNull();
    });

    it('shows error banner when error is set', () => {
      resetStore({}, { error: 'Something went wrong' });
      render(<App />);
      expect(screen.getByTestId('error-banner')).toBeDefined();
      expect(screen.getByTestId('error-banner').textContent).toContain('Something went wrong');
    });

    it('dismisses error when dismiss button clicked', () => {
      resetStore({}, { error: 'Some error' });
      render(<App />);
      fireEvent.click(screen.getByTestId('error-dismiss'));
      expect(screen.queryByTestId('error-banner')).toBeNull();
    });
  });

  describe('SSE integration', () => {
    it('updates connected state via SSE onConnect', async () => {
      render(<App />);
      await waitFor(() => {
        expect(useBoardStore.getState().isConnected).toBe(true);
      });
    });
  });
});
