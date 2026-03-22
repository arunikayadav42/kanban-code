/**
 * useKeyboardShortcuts -- global keyboard event listener for the app.
 *
 * Swift source: Sources/KanbanCode/KeyboardShortcuts.swift
 *
 * Context-aware shortcuts:
 * - Cmd+K / Cmd+P: toggle palette
 * - Cmd+Shift+P: command mode (palette with ">")
 * - Cmd+Enter: toggle detail expand (detail open) OR deep search (palette open)
 * - Cmd+T: new terminal tab (detail on terminal tab)
 * - Cmd+N: new task dialog
 * - Cmd+1-9: switch projects
 * - Escape: deselect card / close palette
 * - Delete/Backspace: delete selected card
 */

import { useEffect, useCallback } from 'react';

// MARK: - Context

export interface ShortcutContext {
  paletteOpen: boolean;
  detailOpen: boolean;
  expandedDetail: boolean;
  terminalTabActive: boolean;
}

// MARK: - Handlers

export interface ShortcutHandlers {
  onTogglePalette?: () => void;
  onOpenCommandMode?: () => void;
  onToggleExpanded?: () => void;
  onDeepSearch?: () => void;
  onNewTerminal?: () => void;
  onNewTask?: () => void;
  onSwitchProject?: (index: number) => void;
  onDeselect?: () => void;
  onDeleteCard?: () => void;
}

// MARK: - Shortcut type

type ShortcutName =
  | 'openPaletteK'
  | 'openPaletteP'
  | 'openCommandMode'
  | 'toggleExpanded'
  | 'deepSearch'
  | 'newTerminal'
  | 'newTask'
  | 'deselect'
  | 'deleteCard'
  | 'project1' | 'project2' | 'project3' | 'project4' | 'project5'
  | 'project6' | 'project7' | 'project8' | 'project9';

interface ShortcutDef {
  name: ShortcutName;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  isActive: (ctx: ShortcutContext) => boolean;
}

// MARK: - Definitions

// All keyboard shortcuts disabled — they conflict with browser shortcuts (Cmd+K, Cmd+P, Cmd+N, Cmd+T, Cmd+1-9).
// In the native macOS app these work because the app owns the window. In a browser tab, the browser gets them first.
// TODO: Re-enable with non-conflicting keys if needed (e.g., "/" for search).
const SHORTCUTS: ShortcutDef[] = [
  // Only Escape survives — doesn't conflict with browser
  { name: 'deselect', key: 'Escape', metaKey: false, shiftKey: false, isActive: () => true },
];

const PROJECT_INDEX_MAP: Partial<Record<ShortcutName, number>> = {
  project1: 0, project2: 1, project3: 2, project4: 3, project5: 4,
  project6: 5, project7: 6, project8: 7, project9: 8,
};

// MARK: - Matcher

/**
 * Find the first matching shortcut for a keyboard event + context.
 * Exported for testing.
 */
export function matchShortcut(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ctx: ShortcutContext,
): ShortcutName | null {
  const meta = e.metaKey || e.ctrlKey; // Ctrl on non-Mac

  for (const def of SHORTCUTS) {
    if (def.key !== e.key) continue;
    if (def.metaKey !== meta) continue;
    if (def.shiftKey !== e.shiftKey) continue;
    if (!def.isActive(ctx)) continue;
    return def.name;
  }
  return null;
}

// MARK: - Hook

export function useKeyboardShortcuts(
  context: ShortcutContext,
  handlers: ShortcutHandlers,
): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept when user is typing in an input/textarea or terminal
      const target = e.target as HTMLElement | null;
      if (target && e.key !== 'Escape') {
        // Skip for form elements
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        // Skip for xterm terminal (canvas inside .xterm container)
        if (target.closest('.xterm')) return;
      }

      const name = matchShortcut(e, context);
      if (!name) return;

      switch (name) {
        case 'openPaletteK':
        case 'openPaletteP':
          e.preventDefault();
          handlers.onTogglePalette?.();
          break;
        case 'openCommandMode':
          e.preventDefault();
          handlers.onOpenCommandMode?.();
          break;
        case 'toggleExpanded':
          e.preventDefault();
          handlers.onToggleExpanded?.();
          break;
        case 'deepSearch':
          e.preventDefault();
          handlers.onDeepSearch?.();
          break;
        case 'newTerminal':
          e.preventDefault();
          handlers.onNewTerminal?.();
          break;
        case 'newTask':
          e.preventDefault();
          handlers.onNewTask?.();
          break;
        case 'deselect':
          // Don't prevent default for Escape (allows native browser behavior)
          handlers.onDeselect?.();
          break;
        case 'deleteCard':
          e.preventDefault();
          handlers.onDeleteCard?.();
          break;
        default: {
          // Project switching
          const idx = PROJECT_INDEX_MAP[name];
          if (idx !== undefined) {
            e.preventDefault();
            handlers.onSwitchProject?.(idx);
          }
          break;
        }
      }
    },
    [context, handlers],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
