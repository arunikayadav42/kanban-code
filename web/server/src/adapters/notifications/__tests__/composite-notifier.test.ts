import { describe, it, expect, vi } from 'vitest';
import { CompositeNotifier } from '../composite-notifier.js';
import type { NotifierPort } from '../../../domain/ports/notifier.js';

/** Creates a mock notifier with configurable behavior. */
function createMockNotifier(options: {
  configured?: boolean;
  shouldFail?: boolean;
} = {}): NotifierPort & { calls: Array<{ title: string; message: string; imageData: Buffer | null; cardId: string | null }> } {
  const calls: Array<{ title: string; message: string; imageData: Buffer | null; cardId: string | null }> = [];

  return {
    calls,
    isConfigured: () => options.configured ?? true,
    sendNotification: vi.fn(async (title, message, imageData, cardId) => {
      if (options.shouldFail) throw new Error('mock failure');
      calls.push({ title, message, imageData, cardId });
    }),
  };
}

describe('CompositeNotifier', () => {
  describe('isConfigured', () => {
    it('always returns true', () => {
      const composite = new CompositeNotifier();
      expect(composite.isConfigured()).toBe(true);
    });

    it('returns true even without primary', () => {
      const composite = new CompositeNotifier(null);
      expect(composite.isConfigured()).toBe(true);
    });
  });

  describe('sendNotification', () => {
    it('uses primary when configured', async () => {
      const primary = createMockNotifier({ configured: true });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(primary, fallback);

      await composite.sendNotification('T', 'M', null, 'card_1');

      expect(primary.calls).toHaveLength(1);
      expect(primary.calls[0].title).toBe('T');
      expect(fallback.calls).toHaveLength(0);
    });

    it('uses fallback when primary is not configured', async () => {
      const primary = createMockNotifier({ configured: false });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(primary, fallback);

      await composite.sendNotification('T', 'M', null, null);

      expect(primary.calls).toHaveLength(0);
      expect(fallback.calls).toHaveLength(1);
    });

    it('uses fallback when no primary is set', async () => {
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(null, fallback);

      await composite.sendNotification('T', 'M', null, null);

      expect(fallback.calls).toHaveLength(1);
    });

    it('falls back when primary throws', async () => {
      const primary = createMockNotifier({ configured: true, shouldFail: true });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(primary, fallback);

      await composite.sendNotification('T', 'M', null, null);

      expect(primary.sendNotification).toHaveBeenCalledTimes(1);
      expect(fallback.calls).toHaveLength(1);
    });

    it('passes imageData to primary but null to fallback', async () => {
      const primary = createMockNotifier({ configured: true });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(primary, fallback);
      const imageData = Buffer.from([0x89, 0x50]);

      await composite.sendNotification('T', 'M', imageData, 'card_1');

      expect(primary.calls[0].imageData).toEqual(imageData);
      expect(fallback.calls).toHaveLength(0);
    });

    it('passes null imageData to fallback on primary failure', async () => {
      const primary = createMockNotifier({ configured: true, shouldFail: true });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(primary, fallback);
      const imageData = Buffer.from([0x89, 0x50]);

      await composite.sendNotification('T', 'M', imageData, 'card_1');

      // Fallback receives null imageData (text only)
      expect(fallback.calls[0].imageData).toBeNull();
      expect(fallback.calls[0].cardId).toBe('card_1');
    });

    it('passes cardId through to both primary and fallback paths', async () => {
      const primary = createMockNotifier({ configured: true, shouldFail: true });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(primary, fallback);

      await composite.sendNotification('T', 'M', null, 'card_abc');

      expect(fallback.calls[0].cardId).toBe('card_abc');
    });
  });

  describe('updatePrimary', () => {
    it('hot-swaps primary notifier', async () => {
      const original = createMockNotifier({ configured: true });
      const replacement = createMockNotifier({ configured: true });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(original, fallback);

      // First call goes to original
      await composite.sendNotification('T1', 'M1', null, null);
      expect(original.calls).toHaveLength(1);

      // Swap
      composite.updatePrimary(replacement);

      // Second call goes to replacement
      await composite.sendNotification('T2', 'M2', null, null);
      expect(replacement.calls).toHaveLength(1);
      expect(original.calls).toHaveLength(1); // unchanged
    });

    it('setting primary to null uses fallback', async () => {
      const primary = createMockNotifier({ configured: true });
      const fallback = createMockNotifier();
      const composite = new CompositeNotifier(primary, fallback);

      composite.updatePrimary(null);
      await composite.sendNotification('T', 'M', null, null);

      expect(primary.calls).toHaveLength(0);
      expect(fallback.calls).toHaveLength(1);
    });
  });
});
