import { describe, it, expect, vi } from 'vitest';
import type { Session } from '@kanban-code/shared';
import { CompositeSessionDiscovery } from '../composite-session-discovery.js';
import { CodingAssistantRegistry } from '../coding-assistant-registry.js';
import type { SessionDiscovery } from '../../domain/ports/session-discovery.js';
import type { ActivityDetector } from '../../domain/ports/activity-detector.js';
import type { SessionStore } from '../../domain/ports/session-store.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    messageCount: 5,
    modifiedTime: '2025-01-15T10:00:00Z',
    assistant: 'claude',
    ...overrides,
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

function mockDiscovery(sessions: Session[]): SessionDiscovery {
  return {
    discoverSessions: async () => sessions,
    discoverNewOrModified: async () => sessions,
  };
}

function failingDiscovery(): SessionDiscovery {
  return {
    discoverSessions: async () => { throw new Error('boom'); },
    discoverNewOrModified: async () => { throw new Error('boom'); },
  };
}

describe('CompositeSessionDiscovery', () => {
  describe('discoverSessions', () => {
    it('returns empty array when no assistants registered', async () => {
      const registry = new CodingAssistantRegistry();
      const composite = new CompositeSessionDiscovery(registry);

      const result = await composite.discoverSessions();
      expect(result).toEqual([]);
    });

    it('merges sessions from multiple assistants sorted by modifiedTime desc', async () => {
      const registry = new CodingAssistantRegistry();
      const claudeSession = makeSession({ id: 'claude-1', modifiedTime: '2025-01-15T08:00:00Z', assistant: 'claude' });
      const geminiSession = makeSession({ id: 'gemini-1', modifiedTime: '2025-01-15T12:00:00Z', assistant: 'gemini' });

      registry.register('claude', mockDiscovery([claudeSession]), mockDetector(), mockStore());
      registry.register('gemini', mockDiscovery([geminiSession]), mockDetector(), mockStore());

      const composite = new CompositeSessionDiscovery(registry);
      const result = await composite.discoverSessions();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('gemini-1'); // newer first
      expect(result[1].id).toBe('claude-1');
    });

    it('handles individual assistant failure gracefully', async () => {
      const registry = new CodingAssistantRegistry();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const validSession = makeSession({ id: 'gemini-1', assistant: 'gemini' });
      registry.register('claude', failingDiscovery(), mockDetector(), mockStore());
      registry.register('gemini', mockDiscovery([validSession]), mockDetector(), mockStore());

      const composite = new CompositeSessionDiscovery(registry);
      const result = await composite.discoverSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('gemini-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('discoverSessions failed for Claude Code'),
      );

      warnSpy.mockRestore();
    });

    it('returns sessions from a single assistant', async () => {
      const registry = new CodingAssistantRegistry();
      const sessions = [
        makeSession({ id: 'a', modifiedTime: '2025-01-15T10:00:00Z' }),
        makeSession({ id: 'b', modifiedTime: '2025-01-15T12:00:00Z' }),
      ];
      registry.register('claude', mockDiscovery(sessions), mockDetector(), mockStore());

      const composite = new CompositeSessionDiscovery(registry);
      const result = await composite.discoverSessions();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('b'); // newer first
      expect(result[1].id).toBe('a');
    });
  });

  describe('discoverNewOrModified', () => {
    it('returns empty array when no assistants registered', async () => {
      const registry = new CodingAssistantRegistry();
      const composite = new CompositeSessionDiscovery(registry);

      const result = await composite.discoverNewOrModified(new Date());
      expect(result).toEqual([]);
    });

    it('merges and sorts results from multiple assistants', async () => {
      const registry = new CodingAssistantRegistry();
      const old = makeSession({ id: 'old', modifiedTime: '2025-01-14T10:00:00Z' });
      const recent = makeSession({ id: 'recent', modifiedTime: '2025-01-16T10:00:00Z', assistant: 'gemini' });

      registry.register('claude', mockDiscovery([old]), mockDetector(), mockStore());
      registry.register('gemini', mockDiscovery([recent]), mockDetector(), mockStore());

      const composite = new CompositeSessionDiscovery(registry);
      const result = await composite.discoverNewOrModified(new Date('2025-01-13T00:00:00Z'));

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('recent');
      expect(result[1].id).toBe('old');
    });

    it('handles individual assistant failure gracefully', async () => {
      const registry = new CodingAssistantRegistry();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const validSession = makeSession({ id: 'g-1', assistant: 'gemini' });
      registry.register('claude', failingDiscovery(), mockDetector(), mockStore());
      registry.register('gemini', mockDiscovery([validSession]), mockDetector(), mockStore());

      const composite = new CompositeSessionDiscovery(registry);
      const result = await composite.discoverNewOrModified(new Date());

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('g-1');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('discoverNewOrModified failed for Claude Code'),
      );

      warnSpy.mockRestore();
    });
  });
});
