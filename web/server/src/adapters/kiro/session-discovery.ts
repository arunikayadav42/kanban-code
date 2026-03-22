import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import type { Session } from '@kanban-code/shared';
import type { SessionDiscovery } from '../../domain/ports/session-discovery.js';
import { KiroSessionParser } from './session-parser.js';

/**
 * Discovers Kiro CLI sessions from the SQLite database.
 *
 * Kiro stores conversations at:
 *   ~/Library/Application Support/kiro-cli/data.sqlite3
 *   Table: conversations_v2 (key TEXT, conversation_id TEXT, value TEXT, created_at TEXT, updated_at TEXT)
 *
 * The `key` column is the raw project directory path.
 * Kiro does not store git branch information.
 */
export class KiroSessionDiscovery implements SessionDiscovery {
  private readonly dbPath: string;

  /** Cache: conversationId -> parsed Session */
  private cachedSessions = new Map<string, Session>();

  /** Database file mtime to skip if unchanged */
  private lastDbMtime: number | null = null;

  constructor(dbPath?: string) {
    this.dbPath =
      dbPath ??
      path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'kiro-cli',
        'data.sqlite3',
      );
  }

  async discoverSessions(): Promise<Session[]> {
    if (!fs.existsSync(this.dbPath)) return [];

    // Mtime-based caching: skip if DB file unchanged
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.dbPath);
    } catch {
      return [];
    }

    const currentMtime = stat.mtimeMs;
    if (this.lastDbMtime === currentMtime) {
      return this.sortedCachedSessions();
    }
    this.lastDbMtime = currentMtime;

    let db: Database.Database;
    try {
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    } catch {
      return [];
    }

    try {
      const rows = db.prepare(
        `SELECT key, conversation_id, value, created_at, updated_at
         FROM conversations_v2
         ORDER BY updated_at DESC`,
      ).all() as Array<{
        key: string;
        conversation_id: string;
        value: string;
        created_at: string;
        updated_at: string;
      }>;

      const seenIds = new Set<string>();

      for (const row of rows) {
        seenIds.add(row.conversation_id);

        // Extract metadata from the value JSON
        let firstPrompt: string | null = null;
        let messageCount = 0;

        try {
          const metadata = KiroSessionParser.extractMetadata(row.value);
          if (metadata) {
            firstPrompt = metadata.firstPrompt ?? null;
            messageCount = metadata.messageCount;
          }
        } catch {
          // Fall back to minimal metadata
        }

        const session: Session = {
          id: row.conversation_id,
          name: null,
          firstPrompt,
          projectPath: row.key || null,
          gitBranch: null,
          messageCount,
          modifiedTime: row.updated_at || row.created_at || new Date().toISOString(),
          jsonlPath: `kiro-sqlite://${row.conversation_id}`,
          assistant: 'kiro',
        };
        this.cachedSessions.set(row.conversation_id, session);
      }

      // Evict sessions that no longer exist in the database
      for (const id of this.cachedSessions.keys()) {
        if (!seenIds.has(id)) {
          this.cachedSessions.delete(id);
        }
      }
    } finally {
      db.close();
    }

    return this.sortedCachedSessions();
  }

  async discoverNewOrModified(_since: Date): Promise<Session[]> {
    return this.discoverSessions();
  }

  private sortedCachedSessions(): Session[] {
    const sessions = Array.from(this.cachedSessions.values());
    sessions.sort(
      (a, b) =>
        new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime(),
    );
    return sessions;
  }
}
