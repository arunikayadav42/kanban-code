import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HookEventStore } from '../hook-event-store.js';

describe('HookEventStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-hook-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readAllEvents', () => {
    it('returns empty array when file does not exist', () => {
      const store = new HookEventStore(tempDir);
      const events = store.readAllEvents();
      expect(events).toEqual([]);
    });

    it('parses JSONL lines into HookEvent objects', () => {
      const lines = [
        JSON.stringify({
          sessionId: 'sess-1',
          event: 'UserPromptSubmit',
          transcriptPath: '/path/to/transcript.jsonl',
          timestamp: '2025-01-15T10:00:00Z',
        }),
        JSON.stringify({
          sessionId: 'sess-2',
          event: 'Stop',
          timestamp: '2025-01-15T10:05:00Z',
        }),
      ].join('\n');

      fs.writeFileSync(path.join(tempDir, 'hook-events.jsonl'), lines, 'utf-8');

      const store = new HookEventStore(tempDir);
      const events = store.readAllEvents();

      expect(events).toHaveLength(2);
      expect(events[0].sessionId).toBe('sess-1');
      expect(events[0].eventName).toBe('UserPromptSubmit');
      expect(events[0].transcriptPath).toBe('/path/to/transcript.jsonl');
      expect(events[0].timestamp).toBe('2025-01-15T10:00:00Z');
      expect(events[1].sessionId).toBe('sess-2');
      expect(events[1].eventName).toBe('Stop');
      expect(events[1].transcriptPath).toBeNull();
    });

    it('skips lines without sessionId', () => {
      const lines = [
        JSON.stringify({ event: 'Stop' }), // no sessionId
        JSON.stringify({ sessionId: 'sess-1', event: 'Stop' }),
      ].join('\n');

      fs.writeFileSync(path.join(tempDir, 'hook-events.jsonl'), lines, 'utf-8');

      const store = new HookEventStore(tempDir);
      const events = store.readAllEvents();

      expect(events).toHaveLength(1);
      expect(events[0].sessionId).toBe('sess-1');
    });

    it('skips empty lines', () => {
      const lines = [
        JSON.stringify({ sessionId: 'sess-1', event: 'Stop' }),
        '',
        JSON.stringify({ sessionId: 'sess-2', event: 'Start' }),
        '',
      ].join('\n');

      fs.writeFileSync(path.join(tempDir, 'hook-events.jsonl'), lines, 'utf-8');

      const store = new HookEventStore(tempDir);
      const events = store.readAllEvents();

      expect(events).toHaveLength(2);
    });

    it('defaults event name to "unknown" when missing', () => {
      const line = JSON.stringify({ sessionId: 'sess-1' });
      fs.writeFileSync(path.join(tempDir, 'hook-events.jsonl'), line, 'utf-8');

      const store = new HookEventStore(tempDir);
      const events = store.readAllEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe('unknown');
    });

    it('uses current time when timestamp is missing or invalid', () => {
      const line = JSON.stringify({ sessionId: 'sess-1', event: 'Stop' });
      fs.writeFileSync(path.join(tempDir, 'hook-events.jsonl'), line, 'utf-8');

      const before = new Date();
      const store = new HookEventStore(tempDir);
      const events = store.readAllEvents();
      const after = new Date();

      expect(events).toHaveLength(1);
      // The timestamp should be a valid ISO string near now
      const ts = new Date(events[0].timestamp);
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it('skips invalid JSON lines', () => {
      const lines = [
        'not valid json',
        JSON.stringify({ sessionId: 'sess-1', event: 'Stop' }),
        '{{broken',
      ].join('\n');

      fs.writeFileSync(path.join(tempDir, 'hook-events.jsonl'), lines, 'utf-8');

      const store = new HookEventStore(tempDir);
      const events = store.readAllEvents();

      expect(events).toHaveLength(1);
      expect(events[0].sessionId).toBe('sess-1');
    });
  });

  describe('readNewEvents (incremental)', () => {
    it('reads new events since last read', () => {
      const filePath = path.join(tempDir, 'hook-events.jsonl');

      // Initial write
      const line1 = JSON.stringify({ sessionId: 'sess-1', event: 'Start' }) + '\n';
      fs.writeFileSync(filePath, line1, 'utf-8');

      const store = new HookEventStore(tempDir);
      const first = store.readNewEvents();
      expect(first).toHaveLength(1);
      expect(first[0].sessionId).toBe('sess-1');

      // Append more
      const line2 = JSON.stringify({ sessionId: 'sess-2', event: 'Stop' }) + '\n';
      fs.appendFileSync(filePath, line2, 'utf-8');

      const second = store.readNewEvents();
      expect(second).toHaveLength(1);
      expect(second[0].sessionId).toBe('sess-2');
    });

    it('returns empty when no new data', () => {
      const filePath = path.join(tempDir, 'hook-events.jsonl');
      const line = JSON.stringify({ sessionId: 'sess-1', event: 'Stop' }) + '\n';
      fs.writeFileSync(filePath, line, 'utf-8');

      const store = new HookEventStore(tempDir);
      store.readNewEvents();
      const second = store.readNewEvents();
      expect(second).toEqual([]);
    });

    it('returns empty when file does not exist', () => {
      const store = new HookEventStore(tempDir);
      const events = store.readNewEvents();
      expect(events).toEqual([]);
    });
  });

  describe('readAllEvents resets offset', () => {
    it('re-reads all events after readAllEvents', () => {
      const filePath = path.join(tempDir, 'hook-events.jsonl');
      const line = JSON.stringify({ sessionId: 'sess-1', event: 'Stop' }) + '\n';
      fs.writeFileSync(filePath, line, 'utf-8');

      const store = new HookEventStore(tempDir);

      // Read once
      store.readNewEvents();

      // readAllEvents resets offset so it re-reads everything
      const allEvents = store.readAllEvents();
      expect(allEvents).toHaveLength(1);
      expect(allEvents[0].sessionId).toBe('sess-1');
    });
  });

  describe('path', () => {
    it('uses default base path', () => {
      const store = new HookEventStore();
      expect(store.path).toBe(path.join(os.homedir(), '.kanban-code', 'hook-events.jsonl'));
    });

    it('uses custom base path', () => {
      const store = new HookEventStore('/custom/base');
      expect(store.path).toBe(path.join('/custom/base', 'hook-events.jsonl'));
    });
  });
});
