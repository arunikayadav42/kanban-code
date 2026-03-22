import { describe, it, expect, vi } from 'vitest';
import { matchShortcut } from '../useKeyboardShortcuts';
import type { ShortcutContext } from '../useKeyboardShortcuts';

// All keyboard shortcuts except Escape were removed to avoid
// conflicting with browser shortcuts (Cmd+K, Cmd+P, Cmd+N, Cmd+T, Cmd+1-9).
// Only Escape (deselect card / close palette) remains active.

describe('matchShortcut', () => {
  const baseCtx: ShortcutContext = {
    paletteOpen: false,
    detailOpen: false,
    expandedDetail: false,
    terminalTabActive: false,
  };

  function makeEvent(overrides: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>) {
    return { key: '', metaKey: false, ctrlKey: false, shiftKey: false, ...overrides };
  }

  describe('Escape (only active shortcut)', () => {
    it('matches deselect on Escape', () => {
      expect(matchShortcut(makeEvent({ key: 'Escape' }), baseCtx)).toBe('deselect');
    });

    it('matches deselect even when palette is open', () => {
      expect(matchShortcut(makeEvent({ key: 'Escape' }), { ...baseCtx, paletteOpen: true })).toBe('deselect');
    });

    it('matches deselect even when detail is open', () => {
      expect(matchShortcut(makeEvent({ key: 'Escape' }), { ...baseCtx, detailOpen: true })).toBe('deselect');
    });
  });

  describe('removed shortcuts return null', () => {
    it('Cmd+K does not match (removed)', () => {
      expect(matchShortcut(makeEvent({ key: 'k', metaKey: true }), baseCtx)).toBeNull();
    });

    it('Cmd+P does not match (removed)', () => {
      expect(matchShortcut(makeEvent({ key: 'p', metaKey: true }), baseCtx)).toBeNull();
    });

    it('Cmd+N does not match (removed)', () => {
      expect(matchShortcut(makeEvent({ key: 'n', metaKey: true }), baseCtx)).toBeNull();
    });

    it('Cmd+T does not match (removed)', () => {
      expect(matchShortcut(makeEvent({ key: 't', metaKey: true }), { ...baseCtx, detailOpen: true, terminalTabActive: true })).toBeNull();
    });

    it('Backspace does not match (removed)', () => {
      expect(matchShortcut(makeEvent({ key: 'Backspace' }), baseCtx)).toBeNull();
    });

    it('Cmd+1 does not match (removed)', () => {
      expect(matchShortcut(makeEvent({ key: '1', metaKey: true }), baseCtx)).toBeNull();
    });

    it('random key does not match', () => {
      expect(matchShortcut(makeEvent({ key: 'a' }), baseCtx)).toBeNull();
    });
  });
});
