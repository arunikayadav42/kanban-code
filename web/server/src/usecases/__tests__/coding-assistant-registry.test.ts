import { describe, it, expect } from 'vitest';
import { CodingAssistantRegistry } from '../coding-assistant-registry.js';
import type { SessionDiscovery } from '../../domain/ports/session-discovery.js';
import type { ActivityDetector } from '../../domain/ports/activity-detector.js';
import type { SessionStore } from '../../domain/ports/session-store.js';

function mockDiscovery(): SessionDiscovery {
  return {
    discoverSessions: async () => [],
    discoverNewOrModified: async () => [],
  };
}

function mockDetector(): ActivityDetector {
  return {
    handleHookEvent: async () => {},
    pollActivity: async () => ({}),
    activityState: async () => 'stale',
    resolvePendingStops: async () => [],
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

describe('CodingAssistantRegistry', () => {
  it('starts with no available assistants', () => {
    const registry = new CodingAssistantRegistry();
    expect(registry.available).toEqual([]);
  });

  it('register adds all three adapters', () => {
    const registry = new CodingAssistantRegistry();
    const discovery = mockDiscovery();
    const detector = mockDetector();
    const store = mockStore();

    registry.register('claude', discovery, detector, store);

    expect(registry.discovery('claude')).toBe(discovery);
    expect(registry.detector('claude')).toBe(detector);
    expect(registry.store('claude')).toBe(store);
  });

  it('returns undefined for unregistered assistant', () => {
    const registry = new CodingAssistantRegistry();

    expect(registry.discovery('gemini')).toBeUndefined();
    expect(registry.detector('gemini')).toBeUndefined();
    expect(registry.store('gemini')).toBeUndefined();
  });

  it('available returns sorted list of registered assistants', () => {
    const registry = new CodingAssistantRegistry();

    // Register gemini first, then claude - should still sort alphabetically
    registry.register('gemini', mockDiscovery(), mockDetector(), mockStore());
    registry.register('claude', mockDiscovery(), mockDetector(), mockStore());

    expect(registry.available).toEqual(['claude', 'gemini']);
  });

  it('unregister removes all three adapters', () => {
    const registry = new CodingAssistantRegistry();
    registry.register('claude', mockDiscovery(), mockDetector(), mockStore());

    registry.unregister('claude');

    expect(registry.discovery('claude')).toBeUndefined();
    expect(registry.detector('claude')).toBeUndefined();
    expect(registry.store('claude')).toBeUndefined();
    expect(registry.available).toEqual([]);
  });

  it('unregister on non-existent assistant is a no-op', () => {
    const registry = new CodingAssistantRegistry();
    registry.register('claude', mockDiscovery(), mockDetector(), mockStore());

    // Should not throw
    registry.unregister('gemini');

    expect(registry.available).toEqual(['claude']);
  });

  it('re-registering replaces existing adapters', () => {
    const registry = new CodingAssistantRegistry();
    const originalDiscovery = mockDiscovery();
    const replacementDiscovery = mockDiscovery();

    registry.register('claude', originalDiscovery, mockDetector(), mockStore());
    registry.register('claude', replacementDiscovery, mockDetector(), mockStore());

    expect(registry.discovery('claude')).toBe(replacementDiscovery);
    expect(registry.available).toEqual(['claude']);
  });
});
