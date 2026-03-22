import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { KiroActivityDetector } from '../activity-detector.js';
import type { HookEvent } from '../../../domain/ports/activity-detector.js';

describe('KiroActivityDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-kiro-activity-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeTempFile(): string {
    const filePath = path.join(tempDir, `data-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
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

      const detector = new KiroActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('actively_working');
    });

    it('file modified 3 min ago -> needs_attention', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 180); // 3 minutes ago

      const detector = new KiroActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('needs_attention');
    });

    it('file modified 30 min ago -> idle_waiting', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 1800); // 30 minutes ago

      const detector = new KiroActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('idle_waiting');
    });

    it('file modified 2 hours ago -> ended', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 7200); // 2 hours ago

      const detector = new KiroActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('ended');
    });

    it('file modified 2 days ago -> stale', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 172800); // 2 days ago

      const detector = new KiroActivityDetector();
      const result = await detector.pollActivity({ s1: filePath });

      expect(result.s1).toBe('stale');
    });

    it('non-existent file -> ended', async () => {
      const detector = new KiroActivityDetector();
      const result = await detector.pollActivity({ s1: '/nonexistent/data.sqlite3' });

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

      const detector = new KiroActivityDetector();
      const result = await detector.pollActivity({ s1: path1, s2: path2 });

      expect(result.s1).toBe('actively_working');
      expect(result.s2).toBe('ended');
    });
  });

  // -- Shared DB Path for Polling --

  describe('shared dbPath polling', () => {
    it('uses dbPath for mtime check when provided', async () => {
      const dbFile = writeTempFile();
      setModTime(dbFile, 30); // recent

      const detector = new KiroActivityDetector(120, 300, dbFile);
      // The sessionPath passed to poll is ignored when dbPath is set
      const result = await detector.pollActivity({ s1: 'kiro-sqlite://some-conv-id' });

      expect(result.s1).toBe('actively_working');
    });
  });

  // -- Cached State --

  describe('cached state', () => {
    it('activityState returns cached state after poll', async () => {
      const filePath = writeTempFile();
      setModTime(filePath, 30);

      const detector = new KiroActivityDetector();
      await detector.pollActivity({ s1: filePath });

      const state = await detector.activityState('s1');
      expect(state).toBe('actively_working');
    });

    it('activityState returns stale for unknown session', async () => {
      const detector = new KiroActivityDetector();
      const state = await detector.activityState('unknown');
      expect(state).toBe('stale');
    });
  });

  // -- Hook Events --

  describe('hook events', () => {
    it('handleHookEvent sets state from UserPromptSubmit', async () => {
      const detector = new KiroActivityDetector();
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
      const detector = new KiroActivityDetector();
      const event: HookEvent = {
        sessionId: 's1',
        eventName: 'Stop',
        timestamp: new Date().toISOString(),
      };
      await detector.handleHookEvent(event);

      const state = await detector.activityState('s1');
      expect(state).toBe('needs_attention');
    });

    it('handleHookEvent normalizes Kiro event names', async () => {
      const detector = new KiroActivityDetector();

      // userPromptSubmit -> UserPromptSubmit
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'userPromptSubmit',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('actively_working');

      // stop -> Stop -> needs_attention
      await detector.handleHookEvent({
        sessionId: 's2',
        eventName: 'stop',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s2')).toBe('needs_attention');

      // agentSpawn -> SessionStart -> idle_waiting
      await detector.handleHookEvent({
        sessionId: 's3',
        eventName: 'agentSpawn',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s3')).toBe('idle_waiting');
    });

    it('handleHookEvent normalizes AfterAgent/BeforeAgent', async () => {
      const detector = new KiroActivityDetector();

      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'AfterAgent',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('needs_attention');

      await detector.handleHookEvent({
        sessionId: 's2',
        eventName: 'BeforeAgent',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s2')).toBe('actively_working');
    });

    it('handleHookEvent sets SessionStart to idle_waiting', async () => {
      const detector = new KiroActivityDetector();
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'SessionStart',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('idle_waiting');
    });

    it('handleHookEvent sets SessionEnd to ended', async () => {
      const detector = new KiroActivityDetector();
      await detector.handleHookEvent({
        sessionId: 's1',
        eventName: 'SessionEnd',
        timestamp: new Date().toISOString(),
      });
      expect(await detector.activityState('s1')).toBe('ended');
    });

    it('handleHookEvent sets Notification to needs_attention', async () => {
      const detector = new KiroActivityDetector();
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

      const detector = new KiroActivityDetector();

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
      const detector = new KiroActivityDetector(120, 0.1); // attentionThreshold = 0.1 seconds

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
      const detector = new KiroActivityDetector(10, 20);
      const result = await detector.pollActivity({ s1: filePath });

      // 30 seconds ago is beyond both thresholds -> idle_waiting
      expect(result.s1).toBe('idle_waiting');
    });
  });

  // -- resolvePendingStops --

  describe('resolvePendingStops', () => {
    it('returns empty (default)', async () => {
      const detector = new KiroActivityDetector();
      const resolved = await detector.resolvePendingStops();
      expect(resolved).toEqual([]);
    });
  });
});
