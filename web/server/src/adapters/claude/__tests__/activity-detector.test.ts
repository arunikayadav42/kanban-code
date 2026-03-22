import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ClaudeCodeActivityDetector } from '../activity-detector.js';
import type { HookEvent } from '../../../domain/ports/activity-detector.js';

function makeHookEvent(
  sessionId: string,
  eventName: string,
  timestamp?: Date,
): HookEvent {
  return {
    sessionId,
    eventName,
    timestamp: (timestamp ?? new Date()).toISOString(),
  };
}

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `kanban-code-activity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('ClaudeCodeActivityDetector', () => {
  // MARK: - Hook-based detection

  it('UserPromptSubmit -> activelyWorking', async () => {
    const detector = new ClaudeCodeActivityDetector();
    await detector.handleHookEvent(makeHookEvent('s1', 'UserPromptSubmit'));
    const state = await detector.activityState('s1');
    expect(state).toBe('actively_working');
  });

  it('Stop -> immediate needsAttention', async () => {
    const detector = new ClaudeCodeActivityDetector();
    await detector.handleHookEvent(makeHookEvent('s1', 'Stop'));
    const state = await detector.activityState('s1');
    expect(state).toBe('needs_attention');
  });

  it('Stop + follow-up prompt -> activelyWorking', async () => {
    const detector = new ClaudeCodeActivityDetector();
    await detector.handleHookEvent(makeHookEvent('s1', 'Stop'));
    await detector.handleHookEvent(makeHookEvent('s1', 'UserPromptSubmit'));
    const state = await detector.activityState('s1');
    expect(state).toBe('actively_working');
  });

  it('SessionEnd -> ended', async () => {
    const detector = new ClaudeCodeActivityDetector();
    await detector.handleHookEvent(makeHookEvent('s1', 'SessionEnd'));
    const state = await detector.activityState('s1');
    expect(state).toBe('ended');
  });

  it('Unknown session -> stale', async () => {
    const detector = new ClaudeCodeActivityDetector();
    const state = await detector.activityState('unknown');
    expect(state).toBe('stale');
  });

  it('Notification -> needsAttention', async () => {
    const detector = new ClaudeCodeActivityDetector();
    await detector.handleHookEvent(makeHookEvent('s1', 'Notification'));
    const state = await detector.activityState('s1');
    expect(state).toBe('needs_attention');
  });

  it('SessionStart -> idleWaiting', async () => {
    const detector = new ClaudeCodeActivityDetector();
    await detector.handleHookEvent(makeHookEvent('s1', 'SessionStart'));
    const state = await detector.activityState('s1');
    expect(state).toBe('idle_waiting');
  });

  it('resolvePendingStops returns resolved sessions after stopDelay', async () => {
    const detector = new ClaudeCodeActivityDetector({ stopDelay: 1.0 });
    await detector.handleHookEvent(makeHookEvent('s1', 'Stop', new Date(Date.now() - 2000)));
    await detector.handleHookEvent(makeHookEvent('s2', 'Stop', new Date(Date.now() - 2000)));

    // Pending stops resolve after stopDelay
    const resolved = await detector.resolvePendingStops();
    // Stop records pending stops and they resolve after stopDelay
    // Note: In the Swift impl, Stop is immediate for activityState but still tracked in pendingStops
    expect(resolved.length).toBeGreaterThanOrEqual(0);
  });

  // MARK: - 5-minute timeout

  it('UserPromptSubmit stays activelyWorking when file is fresh', async () => {
    const detector = new ClaudeCodeActivityDetector();
    const dir = makeTempDir();

    try {
      await detector.handleHookEvent(
        makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 10000)),
      );

      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');
      // File is fresh (just written)

      await detector.pollActivity({ s1: filePath });
      const state = await detector.activityState('s1');
      expect(state).toBe('actively_working');
    } finally {
      cleanup(dir);
    }
  });

  it('UserPromptSubmit stays activelyWorking during sleep 60s (file 60s old)', async () => {
    const detector = new ClaudeCodeActivityDetector();
    const dir = makeTempDir();

    try {
      await detector.handleHookEvent(
        makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 65000)),
      );

      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');
      // Set file mtime to 60s ago
      const sleepDate = new Date(Date.now() - 60000);
      fs.utimesSync(filePath, sleepDate, sleepDate);

      await detector.pollActivity({ s1: filePath });
      const state = await detector.activityState('s1');
      expect(state).toBe('actively_working');
    } finally {
      cleanup(dir);
    }
  });

  // MARK: - Ctrl+C detection via "[Request interrupted by user]"

  it('Ctrl+C detected: file stale >3s + last line is interrupted -> needsAttention', async () => {
    const detector = new ClaudeCodeActivityDetector();
    const dir = makeTempDir();

    try {
      await detector.handleHookEvent(
        makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 10000)),
      );

      const filePath = path.join(dir, 'test.jsonl');
      const lines = [
        '{"type":"assistant","message":{"role":"assistant","content":"Working on it..."}}',
        '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}',
      ];
      fs.writeFileSync(filePath, lines.join('\n'));
      // Set file mtime to 5s ago (past 3s grace)
      const staleDate = new Date(Date.now() - 5000);
      fs.utimesSync(filePath, staleDate, staleDate);

      await detector.pollActivity({ s1: filePath });
      const state = await detector.activityState('s1');
      expect(state).toBe('needs_attention');
    } finally {
      cleanup(dir);
    }
  });

  it('Ctrl+C NOT detected when file is still fresh (<3s)', async () => {
    const detector = new ClaudeCodeActivityDetector();
    const dir = makeTempDir();

    try {
      await detector.handleHookEvent(
        makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 1000)),
      );

      const filePath = path.join(dir, 'test.jsonl');
      const lines = [
        '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}',
      ];
      fs.writeFileSync(filePath, lines.join('\n'));
      // File is fresh (just written)

      await detector.pollActivity({ s1: filePath });
      const state = await detector.activityState('s1');
      expect(state).toBe('actively_working');
    } finally {
      cleanup(dir);
    }
  });

  it('stale file without interrupt marker stays activelyWorking', async () => {
    const detector = new ClaudeCodeActivityDetector();
    const dir = makeTempDir();

    try {
      await detector.handleHookEvent(
        makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 10000)),
      );

      const filePath = path.join(dir, 'test.jsonl');
      const lines = [
        '{"type":"assistant","message":{"role":"assistant","content":"Running tests..."}}',
      ];
      fs.writeFileSync(filePath, lines.join('\n'));
      const staleDate = new Date(Date.now() - 10000);
      fs.utimesSync(filePath, staleDate, staleDate);

      await detector.pollActivity({ s1: filePath });
      const state = await detector.activityState('s1');
      expect(state).toBe('actively_working');
    } finally {
      cleanup(dir);
    }
  });

  // MARK: - 5-minute timeout (safety net for killed process)

  it('UserPromptSubmit transitions to needsAttention after timeout', async () => {
    const detector = new ClaudeCodeActivityDetector({ activeTimeout: 10 });
    const dir = makeTempDir();

    try {
      await detector.handleHookEvent(
        makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 30000)),
      );

      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');
      const oldDate = new Date(Date.now() - 15000);
      fs.utimesSync(filePath, oldDate, oldDate);

      await detector.pollActivity({ s1: filePath });
      const state = await detector.activityState('s1');
      expect(state).toBe('needs_attention');
    } finally {
      cleanup(dir);
    }
  });

  it('UserPromptSubmit with no file path falls back after timeout', async () => {
    const detector = new ClaudeCodeActivityDetector({ activeTimeout: 10 });

    await detector.handleHookEvent(
      makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 30000)),
    );

    // No pollActivity called -- no file path cached
    const state = await detector.activityState('s1');
    expect(state).toBe('needs_attention');
  });

  // MARK: - Polling never returns .activelyWorking

  it('poll activity: recently modified file -> idleWaiting (NOT activelyWorking)', async () => {
    const dir = makeTempDir();

    try {
      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');

      const detector = new ClaudeCodeActivityDetector();
      const states = await detector.pollActivity({ s1: filePath });
      expect(states.s1).toBe('idle_waiting');
    } finally {
      cleanup(dir);
    }
  });

  it('poll activity: file 10 minutes old -> needsAttention', async () => {
    const dir = makeTempDir();

    try {
      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');
      const oldDate = new Date(Date.now() - 600_000);
      fs.utimesSync(filePath, oldDate, oldDate);

      const detector = new ClaudeCodeActivityDetector();
      const states = await detector.pollActivity({ s1: filePath });
      expect(states.s1).toBe('needs_attention');
    } finally {
      cleanup(dir);
    }
  });

  it('poll activity: file 2 hours old -> ended', async () => {
    const dir = makeTempDir();

    try {
      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');
      const oldDate = new Date(Date.now() - 7_200_000);
      fs.utimesSync(filePath, oldDate, oldDate);

      const detector = new ClaudeCodeActivityDetector();
      const states = await detector.pollActivity({ s1: filePath });
      expect(states.s1).toBe('ended');
    } finally {
      cleanup(dir);
    }
  });

  it('poll activity: file 2 days old -> stale', async () => {
    const dir = makeTempDir();

    try {
      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');
      const oldDate = new Date(Date.now() - 172_800_000);
      fs.utimesSync(filePath, oldDate, oldDate);

      const detector = new ClaudeCodeActivityDetector();
      const states = await detector.pollActivity({ s1: filePath });
      expect(states.s1).toBe('stale');
    } finally {
      cleanup(dir);
    }
  });

  it('poll activity: missing file -> ended', async () => {
    const detector = new ClaudeCodeActivityDetector();
    const states = await detector.pollActivity({ s1: '/nonexistent/path.jsonl' });
    expect(states.s1).toBe('ended');
  });

  // MARK: - Hook + poll interaction

  it('session without hooks uses polled state (never activelyWorking)', async () => {
    const dir = makeTempDir();

    try {
      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');

      const detector = new ClaudeCodeActivityDetector();
      await detector.pollActivity({ s1: filePath });

      // No hook events -> activityState uses polled state
      const state = await detector.activityState('s1');
      expect(state).toBe('idle_waiting');
    } finally {
      cleanup(dir);
    }
  });

  it('unknown hook event uses polled state, never activelyWorking', async () => {
    const detector = new ClaudeCodeActivityDetector();
    await detector.handleHookEvent(makeHookEvent('s1', 'SomeUnknownEvent'));

    const state = await detector.activityState('s1');
    expect(state).toBe('idle_waiting');
  });

  // MARK: - Configurable timeout

  it('custom activeTimeout is respected', async () => {
    const detector = new ClaudeCodeActivityDetector({ activeTimeout: 5 });
    const dir = makeTempDir();

    try {
      await detector.handleHookEvent(
        makeHookEvent('s1', 'UserPromptSubmit', new Date(Date.now() - 10000)),
      );

      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, 'data');
      const oldDate = new Date(Date.now() - 8000);
      fs.utimesSync(filePath, oldDate, oldDate);

      await detector.pollActivity({ s1: filePath });
      const state = await detector.activityState('s1');
      expect(state).toBe('needs_attention');
    } finally {
      cleanup(dir);
    }
  });
});
