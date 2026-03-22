import { describe, it, expect, vi } from 'vitest';
import type { ActivityState } from '@kanban-code/shared';
import { CompositeActivityDetector } from '../composite-activity-detector.js';
import { CodingAssistantRegistry } from '../coding-assistant-registry.js';
import type { ActivityDetector, HookEvent } from '../../domain/ports/activity-detector.js';
import type { SessionDiscovery } from '../../domain/ports/session-discovery.js';
import type { SessionStore } from '../../domain/ports/session-store.js';

function mockDiscovery(): SessionDiscovery {
  return {
    discoverSessions: async () => [],
    discoverNewOrModified: async () => [],
  };
}

function mockStore(): SessionStore {
  return {
    readTranscript: async () => [],
    forkSession: async () => '',
    truncateSession: async () => {},
    searchSessions: async () => [],
    searchSessionsStreaming: async () => {},
    writeSession: async () => '',
    resolveSessionPath: (_sessionId: string, originalPath: string) => originalPath,
  };
}

function mockDetector(overrides: Partial<ActivityDetector> = {}): ActivityDetector {
  return {
    handleHookEvent: async () => {},
    pollActivity: async () => ({}),
    activityState: async () => 'stale' as ActivityState,
    resolvePendingStops: async () => [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    sessionId: 'sess-1',
    eventName: 'SessionStart',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('CompositeActivityDetector', () => {
  describe('handleHookEvent', () => {
    it('forwards event to all registered detectors', async () => {
      const registry = new CodingAssistantRegistry();
      const claudeHandler = vi.fn();
      const geminiHandler = vi.fn();

      registry.register('claude', mockDiscovery(),
        mockDetector({ handleHookEvent: claudeHandler }), mockStore());
      registry.register('gemini', mockDiscovery(),
        mockDetector({ handleHookEvent: geminiHandler }), mockStore());

      const composite = new CompositeActivityDetector(registry);
      const event = makeEvent();
      await composite.handleHookEvent(event);

      expect(claudeHandler).toHaveBeenCalledWith(event);
      expect(geminiHandler).toHaveBeenCalledWith(event);
    });

    it('does nothing when no detectors registered', async () => {
      const registry = new CodingAssistantRegistry();
      const composite = new CompositeActivityDetector(registry);

      // Should not throw
      await composite.handleHookEvent(makeEvent());
    });
  });

  describe('pollActivity', () => {
    it('returns empty when no detectors registered', async () => {
      const registry = new CodingAssistantRegistry();
      const composite = new CompositeActivityDetector(registry);

      const result = await composite.pollActivity({ 'sess-1': '/path' });
      expect(result).toEqual({});
    });

    it('merges results from multiple detectors', async () => {
      const registry = new CodingAssistantRegistry();

      registry.register('claude', mockDiscovery(),
        mockDetector({
          pollActivity: async () => ({ 'sess-1': 'idle_waiting' as ActivityState }),
        }), mockStore());
      registry.register('gemini', mockDiscovery(),
        mockDetector({
          pollActivity: async () => ({ 'sess-2': 'actively_working' as ActivityState }),
        }), mockStore());

      const composite = new CompositeActivityDetector(registry);
      const result = await composite.pollActivity({ 'sess-1': '/a', 'sess-2': '/b' });

      expect(result['sess-1']).toBe('idle_waiting');
      expect(result['sess-2']).toBe('actively_working');
    });

    it('keeps highest-priority state when detectors report same session', async () => {
      const registry = new CodingAssistantRegistry();

      registry.register('claude', mockDiscovery(),
        mockDetector({
          pollActivity: async () => ({ 'sess-1': 'idle_waiting' as ActivityState }),
        }), mockStore());
      registry.register('gemini', mockDiscovery(),
        mockDetector({
          pollActivity: async () => ({ 'sess-1': 'actively_working' as ActivityState }),
        }), mockStore());

      const composite = new CompositeActivityDetector(registry);
      const result = await composite.pollActivity({ 'sess-1': '/path' });

      expect(result['sess-1']).toBe('actively_working');
    });

    it('does not replace higher-priority state with lower', async () => {
      const registry = new CodingAssistantRegistry();

      // Claude is registered first (alphabetically) and reports higher priority
      registry.register('claude', mockDiscovery(),
        mockDetector({
          pollActivity: async () => ({ 'sess-1': 'actively_working' as ActivityState }),
        }), mockStore());
      registry.register('gemini', mockDiscovery(),
        mockDetector({
          pollActivity: async () => ({ 'sess-1': 'stale' as ActivityState }),
        }), mockStore());

      const composite = new CompositeActivityDetector(registry);
      const result = await composite.pollActivity({ 'sess-1': '/path' });

      expect(result['sess-1']).toBe('actively_working');
    });
  });

  describe('activityState', () => {
    it('returns stale when no detectors registered', async () => {
      const registry = new CodingAssistantRegistry();
      const composite = new CompositeActivityDetector(registry);

      const state = await composite.activityState('sess-1');
      expect(state).toBe('stale');
    });

    it('returns highest-priority state across all detectors', async () => {
      const registry = new CodingAssistantRegistry();

      registry.register('claude', mockDiscovery(),
        mockDetector({
          activityState: async () => 'idle_waiting' as ActivityState,
        }), mockStore());
      registry.register('gemini', mockDiscovery(),
        mockDetector({
          activityState: async () => 'actively_working' as ActivityState,
        }), mockStore());

      const composite = new CompositeActivityDetector(registry);
      const state = await composite.activityState('sess-1');

      expect(state).toBe('actively_working');
    });

    it('returns single detector state when only one registered', async () => {
      const registry = new CodingAssistantRegistry();

      registry.register('claude', mockDiscovery(),
        mockDetector({
          activityState: async () => 'needs_attention' as ActivityState,
        }), mockStore());

      const composite = new CompositeActivityDetector(registry);
      const state = await composite.activityState('sess-1');

      expect(state).toBe('needs_attention');
    });
  });

  describe('resolvePendingStops', () => {
    it('returns empty when no detectors registered', async () => {
      const registry = new CodingAssistantRegistry();
      const composite = new CompositeActivityDetector(registry);

      const result = await composite.resolvePendingStops();
      expect(result).toEqual([]);
    });

    it('combines resolved session IDs from all detectors', async () => {
      const registry = new CodingAssistantRegistry();

      registry.register('claude', mockDiscovery(),
        mockDetector({
          resolvePendingStops: async () => ['sess-1', 'sess-2'],
        }), mockStore());
      registry.register('gemini', mockDiscovery(),
        mockDetector({
          resolvePendingStops: async () => ['sess-3'],
        }), mockStore());

      const composite = new CompositeActivityDetector(registry);
      const result = await composite.resolvePendingStops();

      expect(result).toEqual(['sess-1', 'sess-2', 'sess-3']);
    });
  });
});
