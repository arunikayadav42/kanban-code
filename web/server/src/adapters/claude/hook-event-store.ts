import fs from 'fs';
import path from 'path';
import os from 'os';
import type { HookEvent } from '../../domain/ports/activity-detector.js';

/**
 * Reads and manages hook events from ~/.kanban-code/hook-events.jsonl.
 * Supports incremental reads via a tracked file offset.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/HookEventStore.swift
 *
 * Note: Swift uses actor isolation. Node.js is single-threaded so we use
 * a plain class with synchronous file reads.
 */
export class HookEventStore {
  private readonly filePath: string;
  private lastReadOffset = 0;

  constructor(basePath?: string) {
    const base = basePath ?? path.join(os.homedir(), '.kanban-code');
    this.filePath = path.join(base, 'hook-events.jsonl');
  }

  /** Read new events since the last read. */
  readNewEvents(): HookEvent[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const fd = fs.openSync(this.filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const bytesToRead = stat.size - this.lastReadOffset;
      if (bytesToRead <= 0) {
        return [];
      }

      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, this.lastReadOffset);
      this.lastReadOffset = stat.size;

      const text = buffer.toString('utf-8');
      return this.parseLines(text);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Read all events (for initial load). Resets offset first. */
  readAllEvents(): HookEvent[] {
    this.lastReadOffset = 0;
    return this.readNewEvents();
  }

  /** The file path. */
  get path(): string {
    return this.filePath;
  }

  /** Parse JSONL text into HookEvent objects. */
  private parseLines(text: string): HookEvent[] {
    const events: HookEvent[] = [];

    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue; // skip unparseable lines
      }

      const sessionId = obj.sessionId;
      if (typeof sessionId !== 'string') continue;

      const eventName = typeof obj.event === 'string' ? obj.event : 'unknown';
      const transcriptPath = typeof obj.transcriptPath === 'string' ? obj.transcriptPath : null;

      let timestamp: string;
      if (typeof obj.timestamp === 'string') {
        const parsed = new Date(obj.timestamp);
        timestamp = isNaN(parsed.getTime()) ? new Date().toISOString() : obj.timestamp;
      } else {
        timestamp = new Date().toISOString();
      }

      events.push({
        sessionId,
        eventName,
        transcriptPath,
        timestamp,
      });
    }

    return events;
  }
}
