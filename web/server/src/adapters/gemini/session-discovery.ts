import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Session } from '@kanban-code/shared';
import type { SessionDiscovery } from '../../domain/ports/session-discovery.js';
import { GeminiSessionParser } from './session-parser.js';

/**
 * Discovers Gemini CLI sessions by reading `~/.gemini/projects.json` for slug->path mapping
 * and scanning `~/.gemini/tmp/<slug>/chats/session-*.json` files.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Gemini/GeminiSessionDiscovery.swift
 */
export class GeminiSessionDiscovery implements SessionDiscovery {
  private readonly geminiDir: string;
  private lastScanTime: Date | null = null;

  /** Cache: sessionId -> parsed session */
  private cachedSessions = new Map<string, Session>();
  /** Per-chats-directory mtime to skip unchanged slug dirs */
  private dirMtimes = new Map<string, number>();
  /** Per-file mtime to skip unchanged session files */
  private fileMtimes = new Map<string, number>();
  /** Track which sessions came from which slug for eviction */
  private slugSessionIds = new Map<string, Set<string>>();

  constructor(geminiDir?: string) {
    this.geminiDir =
      geminiDir ?? path.join(os.homedir(), '.gemini');
  }

  async discoverSessions(): Promise<Session[]> {
    if (!fs.existsSync(this.geminiDir)) return [];

    const slugToPath = this.readProjectsMapping();

    const tmpDir = path.join(this.geminiDir, 'tmp');
    if (!fs.existsSync(tmpDir)) return [];

    let slugDirs: string[];
    try {
      slugDirs = fs.readdirSync(tmpDir);
    } catch {
      return [];
    }

    const seenSlugs = new Set<string>();

    for (const slug of slugDirs) {
      const chatsDir = path.join(tmpDir, slug, 'chats');

      let stat: fs.Stats;
      try {
        stat = fs.statSync(chatsDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      seenSlugs.add(slug);

      // Check directory mtime -- skip if unchanged
      const dirMtime = stat.mtimeMs;
      if (this.dirMtimes.get(slug) === dirMtime) {
        continue;
      }
      this.dirMtimes.set(slug, dirMtime);

      const projectPath = this.resolveProjectPath(slug, slugToPath);

      let files: string[];
      try {
        files = fs.readdirSync(chatsDir);
      } catch {
        continue;
      }

      const sessionFiles = files.filter(
        f => f.startsWith('session-') && f.endsWith('.json'),
      );

      const slugSessions = new Set<string>();

      for (const fileName of sessionFiles) {
        const filePath = path.join(chatsDir, fileName);

        let fileStat: fs.Stats;
        try {
          fileStat = fs.statSync(filePath);
        } catch {
          continue;
        }
        const mtime = fileStat.mtimeMs;

        // Check if already cached by file path
        let existingSessionId: string | null = null;
        for (const [id, session] of this.cachedSessions) {
          if (session.jsonlPath === filePath) {
            existingSessionId = id;
            break;
          }
        }

        if (existingSessionId) {
          slugSessions.add(existingSessionId);
          if (this.fileMtimes.get(filePath) === mtime) {
            continue;
          }
        }

        this.fileMtimes.set(filePath, mtime);

        try {
          const metadata = GeminiSessionParser.extractMetadata(filePath);
          if (metadata) {
            const session: Session = {
              id: metadata.sessionId,
              name: metadata.summary ?? null,
              firstPrompt: metadata.firstPrompt ?? null,
              projectPath: projectPath ?? null,
              messageCount: metadata.messageCount,
              modifiedTime: fileStat.mtime.toISOString(),
              jsonlPath: filePath,
              assistant: 'gemini',
            };
            this.cachedSessions.set(metadata.sessionId, session);
            slugSessions.add(metadata.sessionId);
          }
        } catch {
          continue;
        }
      }

      // Evict sessions from this slug that no longer exist
      const oldIds = this.slugSessionIds.get(slug);
      if (oldIds) {
        for (const removedId of oldIds) {
          if (!slugSessions.has(removedId)) {
            this.cachedSessions.delete(removedId);
          }
        }
      }
      this.slugSessionIds.set(slug, slugSessions);
    }

    // Evict slugs that were removed
    for (const slug of this.dirMtimes.keys()) {
      if (!seenSlugs.has(slug)) {
        this.dirMtimes.delete(slug);
        const ids = this.slugSessionIds.get(slug);
        if (ids) {
          for (const id of ids) {
            this.cachedSessions.delete(id);
          }
          this.slugSessionIds.delete(slug);
        }
      }
    }

    const sessions = Array.from(this.cachedSessions.values());
    sessions.sort(
      (a, b) =>
        new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime(),
    );
    this.lastScanTime = new Date();
    return sessions;
  }

  async discoverNewOrModified(_since: Date): Promise<Session[]> {
    return this.discoverSessions();
  }

  // MARK: - Project Mapping

  private readProjectsMapping(): Map<string, string> {
    const projectsPath = path.join(this.geminiDir, 'projects.json');
    let data: string;
    try {
      data = fs.readFileSync(projectsPath, 'utf-8');
    } catch {
      return new Map();
    }

    try {
      const parsed = JSON.parse(data) as { projects?: Record<string, string> };
      if (!parsed.projects) return new Map();

      // Invert: projects.json maps path->slug, we need slug->path
      const slugToPath = new Map<string, string>();
      for (const [projectPath, slug] of Object.entries(parsed.projects)) {
        slugToPath.set(slug, projectPath);
      }
      return slugToPath;
    } catch {
      return new Map();
    }
  }

  private resolveProjectPath(
    slug: string,
    slugToPath: Map<string, string>,
  ): string | null {
    return slugToPath.get(slug) ?? null;
  }
}
