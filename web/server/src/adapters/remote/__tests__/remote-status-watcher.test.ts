import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RemoteStatusWatcher } from '../remote-status-watcher.js';
import type { NotifierPort } from '../../../domain/ports/notifier.js';

/** Creates a mock NotifierPort that records calls. */
function mockNotifier(): NotifierPort & { calls: { title: string; message: string }[] } {
  const calls: { title: string; message: string }[] = [];
  return {
    calls,
    sendNotification: async (title, message) => {
      calls.push({ title, message });
    },
    isConfigured: () => true,
  };
}

describe('RemoteStatusWatcher', () => {
  const tmpDir = path.join(os.tmpdir(), `kanban-remote-status-test-${process.pid}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeStatusFile(host: string, status: string, since?: string): void {
    const data: Record<string, unknown> = { status };
    if (since) data.since = since;
    fs.writeFileSync(path.join(tmpDir, `status-${host}.json`), JSON.stringify(data), 'utf-8');
  }

  describe('isOnline', () => {
    it('returns true when no status file exists', () => {
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir });
      expect(watcher.isOnline('devbox')).toBe(true);
    });

    it('returns true when status is online', () => {
      writeStatusFile('devbox', 'online');
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir });
      expect(watcher.isOnline('devbox')).toBe(true);
    });

    it('returns false when status is offline', () => {
      writeStatusFile('devbox', 'offline', '2024-01-01T00:00:00Z');
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir });
      expect(watcher.isOnline('devbox')).toBe(false);
    });

    it('returns true for malformed JSON', () => {
      fs.writeFileSync(path.join(tmpDir, 'status-devbox.json'), 'not json', 'utf-8');
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir });
      expect(watcher.isOnline('devbox')).toBe(true);
    });

    it('returns true when status field is missing', () => {
      fs.writeFileSync(path.join(tmpDir, 'status-devbox.json'), '{"other":"field"}', 'utf-8');
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir });
      expect(watcher.isOnline('devbox')).toBe(true);
    });
  });

  describe('pollStatusChanges', () => {
    it('does nothing when stateDir does not exist', async () => {
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({
        stateDir: path.join(tmpDir, 'nonexistent'),
        notifier,
      });
      await watcher.pollStatusChanges();
      expect(notifier.calls).toHaveLength(0);
    });

    it('does nothing when no status files exist', async () => {
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });
      await watcher.pollStatusChanges();
      expect(notifier.calls).toHaveLength(0);
    });

    it('notifies on first poll when host is already offline', async () => {
      writeStatusFile('devbox', 'offline', '2024-01-01T00:00:00Z');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges();

      expect(notifier.calls).toHaveLength(1);
      expect(notifier.calls[0]!.title).toBe('Remote Connection Lost');
      expect(notifier.calls[0]!.message).toContain('devbox');
    });

    it('does not notify on first poll when host is online', async () => {
      writeStatusFile('devbox', 'online');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges();

      expect(notifier.calls).toHaveLength(0);
    });

    it('notifies when host transitions online to offline', async () => {
      writeStatusFile('devbox', 'online');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges(); // first poll: online
      expect(notifier.calls).toHaveLength(0);

      writeStatusFile('devbox', 'offline', '2024-01-01T00:00:00Z');
      await watcher.pollStatusChanges(); // second poll: offline

      expect(notifier.calls).toHaveLength(1);
      expect(notifier.calls[0]!.title).toBe('Remote Connection Lost');
    });

    it('notifies when host transitions offline to online', async () => {
      writeStatusFile('devbox', 'offline', '2024-01-01T00:00:00Z');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges(); // first poll: offline
      expect(notifier.calls).toHaveLength(1); // Initial offline notification

      writeStatusFile('devbox', 'online');
      await watcher.pollStatusChanges(); // second poll: online

      expect(notifier.calls).toHaveLength(2);
      expect(notifier.calls[1]!.title).toBe('Remote Connection Restored');
      expect(notifier.calls[1]!.message).toContain('devbox');
    });

    it('does not notify when status remains the same', async () => {
      writeStatusFile('devbox', 'online');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges();
      await watcher.pollStatusChanges();
      await watcher.pollStatusChanges();

      expect(notifier.calls).toHaveLength(0);
    });

    it('tracks multiple hosts independently', async () => {
      writeStatusFile('devbox1', 'online');
      writeStatusFile('devbox2', 'offline', '2024-01-01T00:00:00Z');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges();

      // Only devbox2 should notify (offline on first poll)
      expect(notifier.calls).toHaveLength(1);
      expect(notifier.calls[0]!.message).toContain('devbox2');
    });

    it('ignores files not matching status-*.json pattern', async () => {
      fs.writeFileSync(path.join(tmpDir, 'other-file.json'), '{"status":"offline"}', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'status-host.txt'), '{"status":"offline"}', 'utf-8');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges();
      expect(notifier.calls).toHaveLength(0);
    });

    it('skips files with empty host name', async () => {
      fs.writeFileSync(path.join(tmpDir, 'status-.json'), '{"status":"offline"}', 'utf-8');
      const notifier = mockNotifier();
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      await watcher.pollStatusChanges();
      expect(notifier.calls).toHaveLength(0);
    });

    it('handles notification failure gracefully', async () => {
      writeStatusFile('devbox', 'offline', '2024-01-01T00:00:00Z');
      const notifier: NotifierPort = {
        sendNotification: async () => { throw new Error('push failed'); },
        isConfigured: () => true,
      };
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir, notifier });

      // Should not throw despite notification failure
      await expect(watcher.pollStatusChanges()).resolves.toBeUndefined();
    });

    it('works without a notifier', async () => {
      writeStatusFile('devbox', 'offline', '2024-01-01T00:00:00Z');
      const watcher = new RemoteStatusWatcher({ stateDir: tmpDir });

      await expect(watcher.pollStatusChanges()).resolves.toBeUndefined();
    });
  });
});
