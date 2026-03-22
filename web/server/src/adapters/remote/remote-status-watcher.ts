/**
 * Watches ~/.kanban-code/remote/status-*.json files for remote connection status changes.
 * Posts notifications via a NotifierPort when a host goes offline or comes back online.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Remote/RemoteStatusWatcher.swift
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { NotifierPort } from '../../domain/ports/notifier.js';

/** Lightweight representation of a host's connection status. */
interface RemoteHostStatus {
  status: string; // "online" or "offline"
  since: string | null; // ISO 8601 timestamp for offline, null for online
}

export class RemoteStatusWatcher {
  private readonly stateDir: string;
  private readonly notifier: NotifierPort | null;
  private readonly knownStatuses = new Map<string, RemoteHostStatus>();

  constructor(options?: { stateDir?: string; notifier?: NotifierPort | null }) {
    this.stateDir = options?.stateDir ?? path.join(os.homedir(), '.kanban-code', 'remote');
    this.notifier = options?.notifier ?? null;
  }

  /**
   * Check if a given host is currently online.
   * Returns `true` if no status file exists (assume online by default).
   */
  isOnline(host: string): boolean {
    const filePath = this.statusFilePath(host);
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(data) as Record<string, unknown>;
      const status = json.status as string | undefined;
      if (!status) return true;
      return status === 'online';
    } catch {
      return true; // No status file = assume online
    }
  }

  /**
   * Poll all status files and notify on changes.
   * Call this periodically (e.g. from BackgroundOrchestrator tick).
   */
  async pollStatusChanges(): Promise<void> {
    let files: string[];
    try {
      files = fs.readdirSync(this.stateDir);
    } catch {
      return;
    }

    const statusFiles = files.filter(f => f.startsWith('status-') && f.endsWith('.json'));

    for (const file of statusFiles) {
      // Extract host from filename: status-<host>.json
      const name = path.basename(file, '.json'); // "status-<host>"
      const host = name.slice('status-'.length);
      if (!host) continue;

      const filePath = path.join(this.stateDir, file);
      let status: string;
      let since: string | null;
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(data) as Record<string, unknown>;
        status = json.status as string;
        since = (json.since as string) ?? null;
        if (!status) continue;
      } catch {
        continue;
      }

      const current: RemoteHostStatus = { status, since };
      const previous = this.knownStatuses.get(host) ?? null;
      this.knownStatuses.set(host, current);

      // Detect changes and notify
      if (previous !== null && previous.status !== current.status) {
        await this.notifyStatusChange(host, current.status);
      } else if (previous === null && current.status === 'offline') {
        // First poll and already offline -- notify
        await this.notifyStatusChange(host, current.status);
      }
    }
  }

  // MARK: - Private

  private statusFilePath(host: string): string {
    return path.join(this.stateDir, `status-${host}.json`);
  }

  private async notifyStatusChange(host: string, newStatus: string): Promise<void> {
    if (!this.notifier) return;

    let title: string;
    let message: string;

    if (newStatus === 'offline') {
      title = 'Remote Connection Lost';
      message = `Remote connection to ${host} lost \u2014 using local fallback`;
    } else {
      title = 'Remote Connection Restored';
      message = `Remote connection to ${host} restored`;
    }

    try {
      await this.notifier.sendNotification(title, message, null, null);
    } catch {
      // Best effort -- don't throw on notification failure
    }
  }
}
