import { describe, it, expect } from 'vitest';
import { NotificationDeduplicator } from '../notification-deduplicator.js';

/**
 * Ported from: Tests/KanbanCodeCoreTests/NotificationDedupTests.swift
 * All 8 Swift tests are ported 1:1 below.
 */
describe('NotificationDeduplicator', () => {
  describe('shouldNotify', () => {
    it('returns true for first notification', () => {
      const dedup = new NotificationDeduplicator(0.1);
      const should = dedup.shouldNotify('s1', new Date());
      expect(should).toBe(true);
    });

    it('dedup window prevents rapid notifications', () => {
      const dedup = new NotificationDeduplicator(60);
      const t1 = new Date();
      const t2 = new Date(t1.getTime() + 10_000); // 10s later

      const first = dedup.shouldNotify('s1', t1);
      expect(first).toBe(true);

      // 10s later -- within 60s window
      const second = dedup.shouldNotify('s1', t2);
      expect(second).toBe(false); // Should be deduped
    });

    it('events outside dedup window both send', () => {
      const dedup = new NotificationDeduplicator(62);
      const t1 = new Date();
      const t2 = new Date(t1.getTime() + 63_000); // 63s later -- outside window

      const first = dedup.shouldNotify('s1', t1);
      expect(first).toBe(true);

      const second = dedup.shouldNotify('s1', t2);
      expect(second).toBe(true); // Should pass -- outside window
    });

    it('different sessions get independent dedup', () => {
      const dedup = new NotificationDeduplicator(60);
      const now = new Date();

      const s1 = dedup.shouldNotify('s1', now);
      const s2 = dedup.shouldNotify('s2', now);
      expect(s1).toBe(true);
      expect(s2).toBe(true);
    });
  });

  describe('hasPromptedWithin', () => {
    it('detects prompt within 1s window', () => {
      const dedup = new NotificationDeduplicator(62);
      const stopTime = new Date();
      const promptTime = new Date(stopTime.getTime() + 500); // 0.5s after stop

      dedup.recordPrompt('s1', promptTime);

      const prompted = dedup.hasPromptedWithin('s1', stopTime);
      expect(prompted).toBe(true); // Prompt was within 1s of stop
    });

    it('ignores prompt outside 1s window', () => {
      const dedup = new NotificationDeduplicator(62);
      const stopTime = new Date();
      const promptTime = new Date(stopTime.getTime() + 5_000); // 5s after stop

      dedup.recordPrompt('s1', promptTime);

      const prompted = dedup.hasPromptedWithin('s1', stopTime);
      expect(prompted).toBe(false); // Prompt was 5s after stop, outside 1s window
    });

    it('ignores prompt before stop', () => {
      const dedup = new NotificationDeduplicator(62);
      const promptTime = new Date();
      const stopTime = new Date(promptTime.getTime() + 5_000); // Stop is 5s after prompt

      dedup.recordPrompt('s1', promptTime);

      const prompted = dedup.hasPromptedWithin('s1', stopTime);
      expect(prompted).toBe(false); // Prompt was before the stop
    });

    it('returns false when no prompt recorded', () => {
      const dedup = new NotificationDeduplicator(62);
      const prompted = dedup.hasPromptedWithin('s1', new Date());
      expect(prompted).toBe(false);
    });
  });

  describe('batch processing scenario', () => {
    it('multiple stops with prompts in between', () => {
      // Simulates the exact scenario from hook-events.jsonl:
      // UPS@T+0, Stop@T+4, UPS@T+8, Stop@T+10, UPS@T+66, Stop@T+68
      const dedup = new NotificationDeduplicator(62);
      const base = new Date(0); // epoch reference

      // Events processed in a batch (all at once):
      dedup.recordPrompt('s1', new Date(base.getTime() + 0));      // UPS@T+0
      // Stop@T+4 will be checked below
      dedup.recordPrompt('s1', new Date(base.getTime() + 8_000));  // UPS@T+8
      // Stop@T+10 will be checked below
      dedup.recordPrompt('s1', new Date(base.getTime() + 66_000)); // UPS@T+66
      // Stop@T+68 will be checked below

      // Stop@T+4: prompt at T+8 is 4s after -> outside 1s window -> NOT blocked
      const stop1Prompted = dedup.hasPromptedWithin(
        's1',
        new Date(base.getTime() + 4_000),
      );
      expect(stop1Prompted).toBe(false);
      const stop1Send = dedup.shouldNotify(
        's1',
        new Date(base.getTime() + 4_000),
      );
      expect(stop1Send).toBe(true); // First notification sends

      // Stop@T+10: prompt at T+66 is 56s after -> outside 1s window -> NOT blocked
      const stop2Prompted = dedup.hasPromptedWithin(
        's1',
        new Date(base.getTime() + 10_000),
      );
      expect(stop2Prompted).toBe(false);
      const stop2Send = dedup.shouldNotify(
        's1',
        new Date(base.getTime() + 10_000),
      );
      expect(stop2Send).toBe(false); // DEDUPED: only 6s since Stop@T+4

      // Stop@T+68: no prompt after T+68 -> NOT blocked
      const stop3Prompted = dedup.hasPromptedWithin(
        's1',
        new Date(base.getTime() + 68_000),
      );
      expect(stop3Prompted).toBe(false);
      const stop3Send = dedup.shouldNotify(
        's1',
        new Date(base.getTime() + 68_000),
      );
      expect(stop3Send).toBe(true); // Sends: 64s since Stop@T+4, outside 62s window
    });
  });

  describe('clearAllPending', () => {
    it('clears prompt state but not notification state', () => {
      const dedup = new NotificationDeduplicator(62);
      const now = new Date();

      dedup.recordPrompt('s1', now);
      dedup.shouldNotify('s1', now);

      dedup.clearAllPending();

      // Prompt state is cleared
      const prompted = dedup.hasPromptedWithin(
        's1',
        new Date(now.getTime() - 500),
      );
      expect(prompted).toBe(false);

      // Notification dedup state is NOT cleared (shouldNotify still dedupes)
      const shouldSend = dedup.shouldNotify(
        's1',
        new Date(now.getTime() + 1_000),
      );
      expect(shouldSend).toBe(false); // Still within 62s window
    });
  });

  describe('custom window parameter', () => {
    it('hasPromptedWithin respects custom window', () => {
      const dedup = new NotificationDeduplicator(62);
      const stopTime = new Date();
      const promptTime = new Date(stopTime.getTime() + 2_500); // 2.5s after stop

      dedup.recordPrompt('s1', promptTime);

      // Default 1s window: should not find it
      expect(dedup.hasPromptedWithin('s1', stopTime, 1.0)).toBe(false);

      // Custom 3s window: should find it
      expect(dedup.hasPromptedWithin('s1', stopTime, 3.0)).toBe(true);
    });
  });
});
