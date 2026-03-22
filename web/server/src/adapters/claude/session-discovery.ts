import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Session } from '@kanban-code/shared';
import type { SessionDiscovery } from '../../domain/ports/session-discovery.js';

/**
 * Discovers Claude Code sessions by scanning ~/.claude/projects/.
 * Merges sessions-index.json metadata with .jsonl file scanning.
 *
 * Caching strategy: keeps the full result from the last scan. On subsequent
 * scans, only re-processes project directories whose own mtime changed (i.e.
 * files were added/removed/renamed). Within unchanged directories, per-file
 * mtime checks skip re-parsing unchanged .jsonl files.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/ClaudeCodeSessionDiscovery.swift
 */
export class ClaudeCodeSessionDiscovery implements SessionDiscovery {
  private readonly claudeDir: string;

  /** Cache: sessionId -> parsed session (from all dirs combined) */
  private cachedSessions = new Map<string, Session>();
  /** Per-directory mtime to skip unchanged directories entirely */
  private dirMtimes = new Map<string, number>();
  /** Per-file mtime to skip unchanged .jsonl files within changed directories */
  private fileMtimes = new Map<string, number>();
  /** Track which sessions came from which directory for eviction */
  private dirSessionIds = new Map<string, Set<string>>();

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir
      ?? path.join(os.homedir(), '.claude', 'projects');
  }

  async discoverSessions(): Promise<Session[]> {
    if (!fs.existsSync(this.claudeDir)) return [];

    let projectDirs: string[];
    try {
      projectDirs = fs.readdirSync(this.claudeDir);
    } catch {
      return [];
    }

    const seenDirs = new Set<string>();

    for (const dirName of projectDirs) {
      const dirPath = path.join(this.claudeDir, dirName);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(dirPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      seenDirs.add(dirName);

      // Check directory mtime -- skip entirely if unchanged
      const dirMtime = stat.mtimeMs;
      const cachedDirMtime = this.dirMtimes.get(dirName);
      if (cachedDirMtime !== undefined && dirMtime === cachedDirMtime) {
        continue; // No files added/removed in this directory
      }
      this.dirMtimes.set(dirName, dirMtime);

      // Directory changed -- re-scan it
      const dirSessions = new Set<string>();

      // Read index file for summaries
      const indexPath = path.join(dirPath, 'sessions-index.json');
      const indexById = readSessionIndex(indexPath, dirName);

      // Scan .jsonl files
      let contents: string[];
      try {
        contents = fs.readdirSync(dirPath);
      } catch {
        contents = [];
      }
      const jsonlFiles = contents.filter(f => f.endsWith('.jsonl'));

      for (const jsonlFile of jsonlFiles) {
        const filePath = path.join(dirPath, jsonlFile);
        const sessionId = jsonlFile.replace('.jsonl', '');
        dirSessions.add(sessionId);

        let fileStat: fs.Stats;
        try {
          fileStat = fs.statSync(filePath);
        } catch {
          continue;
        }
        const mtime = fileStat.mtimeMs;

        // Skip if file mtime unchanged and we have a cached session
        const cachedFileMtime = this.fileMtimes.get(filePath);
        if (
          cachedFileMtime !== undefined
          && mtime === cachedFileMtime
          && this.cachedSessions.has(sessionId)
        ) {
          // Still merge index data in case index was updated
          const indexEntry = indexById.get(sessionId);
          if (indexEntry) {
            const session = this.cachedSessions.get(sessionId)!;
            if (!session.name) session.name = indexEntry.summary;
            if (!session.projectPath) session.projectPath = indexEntry.projectPath;
          }
          continue;
        }
        this.fileMtimes.set(filePath, mtime);

        // Parse .jsonl for metadata
        const indexEntry = indexById.get(sessionId);
        const metadata = extractJsonlMetadata(filePath);

        if (metadata) {
          const session: Session = {
            id: sessionId,
            name: indexEntry?.summary ?? null,
            firstPrompt: metadata.firstPrompt ?? null,
            projectPath: indexEntry?.projectPath
              ?? metadata.projectPath
              ?? decodeDirectoryName(dirName),
            gitBranch: metadata.gitBranch ?? null,
            messageCount: metadata.messageCount,
            modifiedTime: new Date(mtime).toISOString(),
            jsonlPath: filePath,
            assistant: 'claude',
          };
          this.cachedSessions.set(sessionId, session);
        } else if (indexEntry) {
          // File couldn't parse but we have index data
          const existing = this.cachedSessions.get(sessionId);
          const session: Session = {
            id: sessionId,
            name: existing?.name ?? indexEntry.summary ?? null,
            firstPrompt: existing?.firstPrompt ?? null,
            projectPath: existing?.projectPath ?? indexEntry.projectPath ?? null,
            gitBranch: existing?.gitBranch ?? null,
            messageCount: existing?.messageCount ?? 0,
            modifiedTime: new Date(mtime).toISOString(),
            jsonlPath: filePath,
            assistant: 'claude',
          };
          this.cachedSessions.set(sessionId, session);
        }
      }

      // Evict sessions from this dir that no longer exist
      const oldIds = this.dirSessionIds.get(dirName);
      if (oldIds) {
        for (const removedId of oldIds) {
          if (!dirSessions.has(removedId)) {
            this.cachedSessions.delete(removedId);
          }
        }
      }
      this.dirSessionIds.set(dirName, dirSessions);
    }

    // Evict entire directories that were removed
    for (const [removedDir] of this.dirMtimes) {
      if (!seenDirs.has(removedDir)) {
        this.dirMtimes.delete(removedDir);
        const ids = this.dirSessionIds.get(removedDir);
        if (ids) {
          for (const id of ids) {
            this.cachedSessions.delete(id);
          }
          this.dirSessionIds.delete(removedDir);
        }
      }
    }

    // Filter messageCount > 0, sort by modifiedTime desc
    const sessions = Array.from(this.cachedSessions.values())
      .filter(s => s.messageCount > 0)
      .sort((a, b) => {
        const timeA = new Date(a.modifiedTime).getTime();
        const timeB = new Date(b.modifiedTime).getTime();
        return timeB - timeA;
      });

    return sessions;
  }

  async discoverNewOrModified(_since: Date): Promise<Session[]> {
    return this.discoverSessions();
  }
}

// ---------------------------------------------------------------------------
// Helpers (ported from SessionIndexReader.swift and JsonlParser.swift)
// ---------------------------------------------------------------------------

interface IndexEntry {
  sessionId: string;
  summary?: string | null;
  projectPath: string;
}

/**
 * Read all index entries from a sessions-index.json file.
 * Handles two formats: { sessions: [...] } and { "uuid": { summary: "..." } }.
 */
function readSessionIndex(indexPath: string, directoryName: string): Map<string, IndexEntry> {
  const result = new Map<string, IndexEntry>();
  if (!fs.existsSync(indexPath)) return result;

  let root: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    root = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return result;
  }

  const projectPath = decodeDirectoryName(directoryName);

  // Format 1: { "sessions": [ { "sessionId": "...", "summary": "..." } ] }
  if (Array.isArray(root.sessions)) {
    for (const session of root.sessions as Record<string, unknown>[]) {
      const sessionId = session.sessionId as string | undefined;
      if (!sessionId) continue;
      const summary = (session.summary as string) ?? null;
      result.set(sessionId, { sessionId, summary, projectPath });
    }
  }

  // Format 2: top-level keys are session IDs (UUID-like: >= 32 chars, contains '-')
  if (result.size === 0) {
    for (const [key, value] of Object.entries(root)) {
      if (key.length < 32 || !key.includes('-')) continue;
      let summary: string | null = null;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        summary = (value as Record<string, unknown>).summary as string ?? null;
      }
      result.set(key, { sessionId: key, summary, projectPath });
    }
  }

  return result;
}

interface JsonlMetadata {
  firstPrompt?: string | null;
  projectPath?: string | null;
  gitBranch?: string | null;
  messageCount: number;
}

/** Known metadata XML tag names injected by Claude Code. */
const METADATA_TAG_NAMES = [
  'local-command-caveat',
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
];

const metadataTagRegex = new RegExp(
  `<(${METADATA_TAG_NAMES.join('|')})>[\\s\\S]*?</\\1>`,
  'g',
);

function stripMetadataTags(text: string): string {
  return text.replace(metadataTagRegex, '');
}

function extractTextContent(obj: Record<string, unknown>): string | null {
  const message = obj.message as Record<string, unknown> | undefined;
  if (!message) return null;
  const content = message.content;

  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const texts = (content as Record<string, unknown>[])
      .filter(block => block.type === 'text')
      .map(block => block.text as string)
      .filter(Boolean);
    const joined = texts.join('\n');
    return joined.length > 0 ? joined : null;
  }

  return null;
}

function isMetadataMessage(obj: Record<string, unknown>): boolean {
  if (obj.isMeta === true) return true;
  const text = extractTextContent(obj);
  if (!text || text.length === 0) return false;
  const stripped = stripMetadataTags(text);
  return stripped.trim().length === 0;
}

/**
 * Extract session metadata by reading .jsonl file synchronously.
 * Stops early once the first user message is found (for efficiency).
 */
function extractJsonlMetadata(filePath: string): JsonlMetadata | null {
  if (!fs.existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = raw.split('\n');
  let firstPrompt: string | null = null;
  let projectPath: string | null = null;
  let gitBranch: string | null = null;
  let messageCount = 0;
  let foundFirstUserMessage = false;

  for (const line of lines) {
    if (!line || !line.includes('"type"')) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = obj.type as string | undefined;
    if (!type) continue;

    // Extract project path from cwd
    if (!projectPath && typeof obj.cwd === 'string') {
      projectPath = obj.cwd;
    }

    // Extract git branch
    if (!gitBranch && typeof obj.gitBranch === 'string') {
      gitBranch = obj.gitBranch;
    }

    if (type === 'user' || type === 'assistant') {
      messageCount += 1;
    }

    // Extract first user message (skip metadata injected by Claude Code)
    if (type === 'user' && !foundFirstUserMessage) {
      if (isMetadataMessage(obj)) continue;
      foundFirstUserMessage = true;
      const text = extractTextContent(obj);
      if (text) {
        firstPrompt = stripMetadataTags(text).trim();
      }
    }

    // Stop early
    if (messageCount >= 5 && foundFirstUserMessage) {
      break;
    }
  }

  if (messageCount === 0) return null;

  return { firstPrompt, projectPath, gitBranch, messageCount };
}

/**
 * Decode a Claude projects directory name to a filesystem path.
 * e.g., "-Users-rchaves-Projects-remote-langwatch" -> "/Users/rchaves/Projects/remote/langwatch"
 */
function decodeDirectoryName(name: string): string {
  let result = name;
  if (result.startsWith('-')) {
    result = '/' + result.slice(1);
  }
  result = result.replace(/-/g, '/');
  return result;
}
