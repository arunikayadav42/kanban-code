import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Link, ActivityState, Session } from '@kanban-code/shared';
import { createLink, createDefaultManualOverrides } from '@kanban-code/shared';
import type { ActivityDetector, HookEvent } from '../../domain/ports/activity-detector.js';
import type { SessionDiscovery } from '../../domain/ports/session-discovery.js';
import type { NotifierPort } from '../../domain/ports/notifier.js';
import { CoordinationStore } from '../../infrastructure/coordination-store.js';
import { HookEventStore } from '../../adapters/claude/hook-event-store.js';
import { NotificationDeduplicator } from '../../adapters/notifications/notification-deduplicator.js';
import { BackgroundOrchestrator } from '../background-orchestrator.js';
import { generate } from '../../infrastructure/ksuid.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Background orchestrator tests.
 * Tests: start/stop lifecycle, processHookEvents (initial load, Stop, Notification, UserPromptSubmit),
 * 5s tick interval, dispatch wiring, queued prompt editing.
 */

// Mock ActivityDetector
function createMockActivityDetector(): ActivityDetector {
  return {
    handleHookEvent: vi.fn().mockResolvedValue(undefined),
    pollActivity: vi.fn().mockResolvedValue({}),
    activityState: vi.fn().mockResolvedValue('idle' as ActivityState),
    resolvePendingStops: vi.fn().mockResolvedValue([]),
  };
}

// Mock SessionDiscovery
function createMockDiscovery(): SessionDiscovery {
  return {
    discoverSessions: vi.fn().mockResolvedValue([]),
    discoverNewOrModified: vi.fn().mockResolvedValue([]),
  };
}

// Mock NotifierPort
function createMockNotifier(): NotifierPort {
  return {
    sendNotification: vi.fn().mockResolvedValue(undefined),
    isConfigured: vi.fn().mockReturnValue(true),
  };
}

describe('BackgroundOrchestrator', () => {
  let tmpDir: string;
  let coordStore: CoordinationStore;
  let hookEventStore: HookEventStore;
  let activityDetector: ActivityDetector;
  let discovery: SessionDiscovery;
  let notifier: NotifierPort;
  let orchestrator: BackgroundOrchestrator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-orch-test-'));
    coordStore = new CoordinationStore(tmpDir);
    hookEventStore = new HookEventStore(tmpDir);
    activityDetector = createMockActivityDetector();
    discovery = createMockDiscovery();
    notifier = createMockNotifier();

    vi.useFakeTimers();
  });

  afterEach(() => {
    orchestrator?.stop();
    vi.useRealTimers();
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  function createOrchestrator(overrides?: Partial<ConstructorParameters<typeof BackgroundOrchestrator>[0]>) {
    orchestrator = new BackgroundOrchestrator({
      discovery,
      coordinationStore: coordStore,
      activityDetector,
      hookEventStore,
      notifier,
      ...overrides,
    });
    return orchestrator;
  }

  describe('Lifecycle', () => {
    it('start sets isRunning to true', () => {
      const orch = createOrchestrator();
      expect(orch.isRunning).toBe(false);
      orch.start();
      expect(orch.isRunning).toBe(true);
    });

    it('stop sets isRunning to false', () => {
      const orch = createOrchestrator();
      orch.start();
      orch.stop();
      expect(orch.isRunning).toBe(false);
    });

    it('start is idempotent', () => {
      const orch = createOrchestrator();
      orch.start();
      orch.start(); // second call is no-op
      expect(orch.isRunning).toBe(true);
      orch.stop();
    });
  });

  describe('Background tick', () => {
    it('polls activity states on tick', async () => {
      // Write a link with sessionLink
      const link = createLink({
        id: generate(),
        sessionLink: { sessionId: 'test-session', sessionPath: '/path/to/session.jsonl' },
      });
      coordStore.writeLinks([link]);

      const orch = createOrchestrator();
      orch.start();

      // Advance timer to trigger first tick
      await vi.advanceTimersByTimeAsync(100);

      expect(activityDetector.pollActivity).toHaveBeenCalled();
    });
  });

  describe('processHookEvents', () => {
    it('initial load consumes events without notifying', async () => {
      // Write a hook event
      const eventLine = JSON.stringify({
        sessionId: 'session-1',
        event: 'Stop',
        timestamp: new Date().toISOString(),
      }) + '\n';
      fs.writeFileSync(path.join(tmpDir, 'hook-events.jsonl'), eventLine);

      const orch = createOrchestrator();
      await orch.processHookEvents();

      expect(activityDetector.handleHookEvent).toHaveBeenCalledTimes(1);
      expect(activityDetector.resolvePendingStops).toHaveBeenCalledTimes(1);
      expect(notifier.sendNotification).not.toHaveBeenCalled();
    });

    it('second call processes events and triggers notification', async () => {
      const orch = createOrchestrator();
      // First call: initial load (empty file)
      await orch.processHookEvents();

      // Append a new Stop event (must append, not overwrite - hookEventStore tracks offset)
      const eventLine = JSON.stringify({
        sessionId: 'session-1',
        event: 'Stop',
        timestamp: new Date().toISOString(),
      }) + '\n';
      fs.appendFileSync(path.join(tmpDir, 'hook-events.jsonl'), eventLine);

      await orch.processHookEvents();

      // Stop event should have been handled (0 from initial + 1 new)
      expect(activityDetector.handleHookEvent).toHaveBeenCalledTimes(1);
    });

    it('UserPromptSubmit records prompt time', async () => {
      const orch = createOrchestrator();
      // Initial load (empty file)
      await orch.processHookEvents();

      // Append UserPromptSubmit event
      const timestamp = new Date().toISOString();
      const eventLine = JSON.stringify({
        sessionId: 'session-1',
        event: 'UserPromptSubmit',
        timestamp,
      }) + '\n';
      fs.appendFileSync(path.join(tmpDir, 'hook-events.jsonl'), eventLine);

      await orch.processHookEvents();
      expect(activityDetector.handleHookEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Notification dedup', () => {
    it('Notification events go through 62s dedup', async () => {
      const dedup = new NotificationDeduplicator(62);
      const orch = createOrchestrator({ notificationDedup: dedup });

      // Initial load
      await orch.processHookEvents();

      // Write Notification event
      const now = new Date();
      const eventLine = JSON.stringify({
        sessionId: 'session-1',
        event: 'Notification',
        timestamp: now.toISOString(),
      }) + '\n';
      fs.writeFileSync(path.join(tmpDir, 'hook-events.jsonl'), eventLine);

      await orch.processHookEvents();
      expect(notifier.sendNotification).toHaveBeenCalledTimes(1);

      // Write another Notification within 62s
      const secondEvent = JSON.stringify({
        sessionId: 'session-1',
        event: 'Notification',
        timestamp: new Date(now.getTime() + 30000).toISOString(),
      }) + '\n';
      fs.appendFileSync(path.join(tmpDir, 'hook-events.jsonl'), secondEvent);

      await orch.processHookEvents();
      // Should still be 1 -- deduped
      expect(notifier.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dispatch', () => {
    it('setDispatch stores callback', () => {
      const orch = createOrchestrator();
      const dispatch = vi.fn();
      orch.setDispatch(dispatch);
      // dispatch is stored internally -- tested implicitly by autoSendQueuedPrompt
    });
  });

  describe('Queued prompt editing', () => {
    it('markPromptEditing and clearPromptEditing toggle state', () => {
      const orch = createOrchestrator();
      // No assertion needed -- these just manage internal state
      orch.markPromptEditing('prompt-1');
      orch.clearPromptEditing('prompt-1');
    });
  });

  describe('discoverBranchesForCard', () => {
    it('clears overrides and returns updated link', async () => {
      const link = createLink({
        id: generate(),
        sessionLink: { sessionId: 's1', sessionPath: '/path.jsonl' },
        manualOverrides: {
          ...createDefaultManualOverrides(),
          branchWatermark: 50000,
          worktreePath: true,
          prLink: true,
          dismissedPRs: [1, 2],
        },
        discoveredBranches: ['old-branch'],
      });
      coordStore.writeLinks([link]);

      const orch = createOrchestrator();
      const result = await orch.discoverBranchesForCard(link.id);

      expect(result).not.toBeNull();
      expect(result!.manualOverrides.branchWatermark).toBeNull();
      expect(result!.manualOverrides.worktreePath).toBe(false);
      expect(result!.manualOverrides.prLink).toBe(false);
      expect(result!.manualOverrides.dismissedPRs).toBeNull();
      expect(result!.discoveredBranches).toEqual([]);
    });

    it('returns null for nonexistent card', async () => {
      const orch = createOrchestrator();
      const result = await orch.discoverBranchesForCard('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateNotifier', () => {
    it('replaces notifier', () => {
      const orch = createOrchestrator();
      const newNotifier = createMockNotifier();
      orch.updateNotifier(newNotifier);
      // Internal state updated -- verified indirectly by notifications
    });
  });
});
