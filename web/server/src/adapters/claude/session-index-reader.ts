import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Reads sessions-index.json files from Claude's project directories.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/SessionIndexReader.swift
 */

/** An entry from sessions-index.json. */
export interface IndexEntry {
  sessionId: string;
  summary: string | null;
  projectPath: string;
  directoryName: string;
}

/**
 * Decode a Claude projects directory name to a filesystem path.
 * e.g. "-Users-dev-my-project" -> "/Users/dev/my/project"
 *
 * Swift source: JsonlParser.decodeDirectoryName
 */
function decodeDirectoryName(name: string): string {
  let result = name;
  if (result.startsWith('-')) {
    result = '/' + result.slice(1);
  }
  result = result.replaceAll('-', '/');
  return result;
}

export const SessionIndexReader = {
  /**
   * Read all index entries from a sessions-index.json file.
   * Handles two JSON formats:
   *   1. Array-based: { "sessions": [ { "sessionId": "...", "summary": "..." } ] }
   *   2. Object-based: { "uuid-1": { "summary": "..." }, "uuid-2": { ... } }
   */
  readIndex(filePath: string, directoryName: string): IndexEntry[] {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    let root: Record<string, unknown>;
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return [];
      }
      root = parsed as Record<string, unknown>;
    } catch {
      return [];
    }

    const projectPath = decodeDirectoryName(directoryName);
    const entries: IndexEntry[] = [];

    // Format 1: { "sessions": [ { "sessionId": "...", "summary": "..." } ] }
    if (Array.isArray(root.sessions)) {
      for (const session of root.sessions as Record<string, unknown>[]) {
        const sessionId = session.sessionId;
        if (typeof sessionId !== 'string') continue;

        const summary = typeof session.summary === 'string' ? session.summary : null;
        entries.push({
          sessionId,
          summary,
          projectPath,
          directoryName,
        });
      }
    }

    // Format 2: top-level keys are session IDs (UUID-like)
    // Only used as fallback when array format yields nothing
    if (entries.length === 0) {
      for (const [key, value] of Object.entries(root)) {
        // Skip non-UUID-looking keys (must be >= 32 chars and contain '-')
        if (key.length < 32 || !key.includes('-')) continue;

        let summary: string | null = null;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const dict = value as Record<string, unknown>;
          summary = typeof dict.summary === 'string' ? dict.summary : null;
        }

        entries.push({
          sessionId: key,
          summary,
          projectPath,
          directoryName,
        });
      }
    }

    return entries;
  },

  /**
   * Update the summary for a session in its sessions-index.json.
   * Best-effort: finds the index file containing this session and updates in-place.
   */
  updateSummary(sessionId: string, summary: string, claudeDir?: string): void {
    const baseDir = claudeDir ?? path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(baseDir)) return;

    let projectDirs: string[];
    try {
      projectDirs = fs.readdirSync(baseDir);
    } catch {
      return;
    }

    for (const dirName of projectDirs) {
      const dirPath = path.join(baseDir, dirName);
      const indexPath = path.join(dirPath, 'sessions-index.json');

      if (!fs.existsSync(indexPath)) continue;

      let root: Record<string, unknown>;
      try {
        const data = fs.readFileSync(indexPath, 'utf-8');
        root = JSON.parse(data);
        if (typeof root !== 'object' || root === null || Array.isArray(root)) continue;
      } catch {
        continue;
      }

      // Format: { "version": 1, "entries": [ { "sessionId": "...", "summary": "...", ... } ] }
      if (Array.isArray(root.entries)) {
        const entries = root.entries as Record<string, unknown>[];
        const idx = entries.findIndex(e => e.sessionId === sessionId);
        if (idx < 0) continue;

        entries[idx] = { ...entries[idx], summary };
        root.entries = entries;

        const updatedData = JSON.stringify(root, null, 2);
        fs.writeFileSync(indexPath, updatedData, 'utf-8');
        return; // Found and updated
      }
    }
  },
};
