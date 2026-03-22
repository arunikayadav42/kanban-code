import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GeminiActivityDetector } from '../activity-detector.js';
import type { HookEvent } from '../../../domain/ports/activity-detector.js';

describe('GeminiActivityDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-gemini-activity-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeTempFile(): string {
    const filePath = path.join(tempDir, `session-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(filePath, '{}', 'utf-8');
    return filePath;
  }

  function setModTime(filePath: string, secondsAgo: number): void {
    const date = new Date(Date.now() - secondsAgo * 1000);
    fs.utimesSync(filePath, date, date);
  }

  // -- Mtime-Based Activity States --

  describe('mtime-based polling', () => {
    it('recently modified file -> actively_working', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 30); // 30 seconds ago

      const detector = new GeminiActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('actively_working');
    });

    it('file modified 3 min ago -> needs_attention', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 180); // 3 minutes ago

      const detector = new GeminiActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('needs_attention');
    });

    it('file modified 30 min ago -> idle_waiting', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 1800); // 30 minutes ago

      const detector = new GeminiActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('idle_waiting');
    });

    it('file modified 2 hours ago -> ended', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 7200); // 2 hours ago

      const detector = new GeminiActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('ended');
    });

    it('file modified 2 days ago -> stale', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 172800); // 2 days ago

      const detector = new GeminiActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('stale');
    });

    it('non-existent file -> ended', async () => {
      const detector = new GeminiActivityDetector();
      const result = await detector.pollActivity({ s1: '/nonexistent/path.json' });

      expect(result.s1).toBe('ended');
    });
  });

  // -- Multiple Sessions --

  describe('multiple sessions', () => {
    it('polls multiple sessions simultaneously', async () => {
      const path1 = writeTempFile();
      const path2 = writeTempFile();
      setModTime(path1, 10);   // active
      setModTime(path2, 7200); // ended

      const detector = new GeminiActivityDetector();
      const result = await detector.pollActivity({ s1: path1, s2: path2 });

      expect(result.s1).toBe('actively_working');
      expect(result.s2).toBe('ended');
    });
  });

  // -- Cached State --

  describe('cached state', () => {
    it('activityState returns cached state after poll', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 30);

      const detector = new GeminiActivityDetector();
      await detector.pollActivity({ s1: filePath });

      const state = await detector.activityState('s1');
      expect(state).toBe('actively_working');
    });

    it('activityState returns stale for unknown session', async () => {
      const detector = new GeminiActivityDetector();
      const state = await detector.activityState('unknown');
      expect(state).toBe('stale');
    });
  });

  // -- Hook Events --

  describe('hook events', () => {
    it('handleHookEvent sets state from UserPromptSubmit', async () => {
      const detector = new GeminiActivityDetector();
      const event: HookEvent = {
        sessionId: 's1',
        eventName: 'UserPromptSubmit',
        timestamp: new Date().toISOString(),
      };
      await detector.handleHookEvent(event);

      const state = await detector.activityState('s1');
      expect(state).toBe('actively_working');
    });

    it('handleHookEvent sets state from Stop', async () => {
      const detector = new GeminiActivityDetector();
      const event: HookEvent = {
        sessionId: 's1',
        eventName: 'Stop',
        timestamp: new Date().toISOString(),
      };
      await detector.handleHookEvent(event);

      const state = await detector.activityState('s1');
      expect(state).toBe('needs_attention');
    });

    it('handleHookEvent normalizes Gemini event names', async () => {
      const detector = new GeminiActivityDetector();

      // AfterAgent should be treated as Stop
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'AfterAgent',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('needs_attention');

      // BeforeAgent should be treated as UserPromptSubmit
      await detector.handleHookEvent({
        sessionId: 's2',
        eventName: 'BeforeAgent',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s2')).toBe('actively_working');
    });

    it('handleHookEvent sets SessionStart to idle_waiting', async () => {
      const detector = new GeminiActivityDetector();
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'SessionStart',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('idle_waiting');
    });

    it('handleHookEvent sets SessionEnd to ended', async () => {
      const detector = new GeminiActivityDetector();
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'SessionEnd',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('ended');
    });

    it('handleHookEvent sets Notification to needs_attention', async () => {
      const detector = new GeminiActivityDetector();
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'Notification',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('needs_attention');
    });

    it('hook state takes priority over poll state', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 7200); // file says ended

      const detector = new GeminiActivityDetector();

      // Hook says actively working
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'UserPromptSubmit',
        timestamp: new Date().toISOString(),
      });

      // Poll should still return hook state, not file state
      const result = await detector.pollActivity({ s1: filePath });
      expect(result.s1).toBe('actively_working');
    });

    it('hook timeout: actively_working downgrades after attention threshold', async () => {
      // Use tight thresholds for testing
      const detector = new GeminiActivityDetector(120, 0.1); // attentionThreshold = 0.1 seconds

      // Set actively_working via hook
      const oldTimestamp = new Date(Date.now() - 200).toISOString(); // 200ms ago
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'UserPromptSubmit',
        timestamp: oldTimestamp,
      });

      // Wait a tiny bit, then poll
      await new Promise(resolve => setTimeout(resolve, 150));

      const filePath = writeTempFile();
      const result = await detector.pollActivity({ s1: filePath });

      // Should have been downgraded from actively_working to needs_attention
      expect(result.s1).toBe('needs_attention');
    });
  });

  // -- Custom Thresholds --

  describe('custom thresholds', () => {
    it('custom thresholds change classification', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 30); // 30 seconds ago

      // With very tight thresholds: activeThreshold=10, attentionThreshold=20
      const detector = new GeminiActivityDetector(10, 20);
      const result = await detector.pollActivity({ s1: filePath });

      // 30 seconds ago is beyond both thresholds -> idle_waiting
      expect(result.s1).toBe('idle_waiting');
    });
  });

  // -- resolvePendingStops --

  describe('resolvePendingStops', () => {
    it('returns empty (default)', async () => {
      const detector = new GeminiActivityDetector();
      const resolved = await detector.resolvePendingStops();
      expect(resolved).toEqual([]);
    });
  });
});
