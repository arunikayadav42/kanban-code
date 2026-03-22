/**
 * Parses Claude Code .jsonl files line-by-line using streaming.
 * Handles arbitrarily large lines (57KB+).
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/JsonlParser.swift
 */

import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata extracted from a session .jsonl file. */
export interface SessionMetadata {
  sessionId: string;
  firstPrompt: string | null;
  projectPath: string | null;
  gitBranch: string | null;
  messageCount: number;
}

/** A branch discovered from scanning a conversation, with the repo it was pushed from. */
export interface DiscoveredBranch {
  branch: string;
  /** Git repo root where the push happened. null = same as session's projectPath. */
  repoPath: string | null;
}

// ---------------------------------------------------------------------------
// Known metadata XML tag names injected by Claude Code
// ---------------------------------------------------------------------------

const METADATA_TAG_NAMES = [
  'local-command-caveat',
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
];

/** Regex matching any known metadata XML tag pair (greedy within each pair). */
const METADATA_TAG_REGEX = new RegExp(
  `<(${METADATA_TAG_NAMES.join('|')})>[\\s\\S]*?</\\1>`,
  'g',
);

// ---------------------------------------------------------------------------
// Regex patterns for branch detection
// ---------------------------------------------------------------------------

// git push [flags...] origin|upstream <branch>
const PUSH_REGEX = /git\s+push\s+(?:-[^\s]+\s+)*(?:origin|upstream)\s+(\S+)/g;
// git checkout -b <branch> or git checkout -B <branch>
const CHECKOUT_BRANCH_REGEX = /git\s+checkout\s+-[bB]\s+(\S+)/g;
// git switch -c <branch> or git switch --create <branch>
const SWITCH_CREATE_REGEX = /git\s+switch\s+(?:-c|--create)\s+(\S+)/g;
// git worktree add ... -b <branch>
const WORKTREE_ADD_REGEX = /git\s+worktree\s+add\s+\S+\s+-b\s+(\S+)/g;
// cd <path> && ... (extract the directory before && chains)
const CD_REGEX = /cd\s+([^\s;&]+)\s*&&/;

// ---------------------------------------------------------------------------
// Helper: create readline interface from file path (optionally seeking)
// ---------------------------------------------------------------------------

function createLineReader(
  filePath: string,
  startOffset?: number,
): { rl: readline.Interface; stream: fs.ReadStream } {
  const stream = fs.createReadStream(filePath, {
    encoding: 'utf-8',
    start: startOffset && startOffset > 0 ? startOffset : undefined,
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  return { rl, stream };
}

/** Iterate lines from a readline interface. */
async function* iterateLines(rl: readline.Interface): AsyncGenerator<string> {
  for await (const line of rl) {
    yield line;
  }
}

// ---------------------------------------------------------------------------
// JsonlParser
// ---------------------------------------------------------------------------

export class JsonlParser {
  // -----------------------------------------------------------------------
  // extractMetadata
  // -----------------------------------------------------------------------

  /** Extract session metadata by streaming through the .jsonl file.
   *  Stops early once enough messages are found (for efficiency). */
  static async extractMetadata(filePath: string): Promise<SessionMetadata | null> {
    const sessionId = path.basename(filePath, '.jsonl');

    if (!fs.existsSync(filePath)) return null;

    const metadata: SessionMetadata = {
      sessionId,
      firstPrompt: null,
      projectPath: null,
      gitBranch: null,
      messageCount: 0,
    };

    let foundFirstUserMessage = false;

    const { rl, stream } = createLineReader(filePath);

    try {
      for await (const line of iterateLines(rl)) {
        if (!line) continue;

        // Quick pre-filter before JSON parsing
        if (!line.includes('"type"')) continue;

        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        const type = obj.type as string | undefined;
        if (!type) continue;

        // Extract project path from cwd
        if (metadata.projectPath === null && typeof obj.cwd === 'string') {
          metadata.projectPath = obj.cwd;
        }

        // Extract git branch
        if (metadata.gitBranch === null && typeof obj.gitBranch === 'string') {
          metadata.gitBranch = obj.gitBranch;
        }

        if (type === 'user' || type === 'assistant') {
          metadata.messageCount += 1;
        }

        // Extract first user message (skip metadata injected by Claude Code)
        if (type === 'user' && !foundFirstUserMessage) {
          if (JsonlParser.isMetadataMessage(obj)) continue;
          foundFirstUserMessage = true;
          const text = JsonlParser.extractTextContent(obj);
          if (text) {
            metadata.firstPrompt = JsonlParser.stripMetadataTags(text).trim();
          }
        }

        // Stop early -- we only need first prompt + enough messages to confirm non-empty
        if (metadata.messageCount >= 5 && foundFirstUserMessage) {
          break;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    if (metadata.messageCount === 0) return null;
    return metadata;
  }

  // -----------------------------------------------------------------------
  // extractTextContent
  // -----------------------------------------------------------------------

  /** Extract text content from a message object. */
  static extractTextContent(obj: Record<string, unknown>): string | null {
    const message = obj.message as Record<string, unknown> | undefined;
    if (!message) return null;

    const content = message.content;
    if (!content) return null;

    // Content can be a string or an array of content blocks
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
      const texts = (content as Array<Record<string, unknown>>)
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string);
      const joined = texts.join('\n');
      return joined.length === 0 ? null : joined;
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Branch extraction
  // -----------------------------------------------------------------------

  /** Scan a session JSONL for branches that were pushed to a remote. */
  static async extractPushedBranches(
    filePath: string,
    startOffset?: number,
  ): Promise<DiscoveredBranch[]> {
    if (!fs.existsSync(filePath)) return [];

    const { rl, stream } = createLineReader(filePath, startOffset);
    const branchesSet = new Map<string, DiscoveredBranch>();

    try {
      for await (const line of iterateLines(rl)) {
        if (!line) continue;

        // Only parse lines that might contain tool_use (Bash commands)
        if (!line.includes('"tool_use"')) continue;

        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        const message = obj.message as Record<string, unknown> | undefined;
        if (!message) continue;
        const content = message.content;
        if (!Array.isArray(content)) continue;

        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type !== 'tool_use' || block.name !== 'Bash') continue;

          const input = block.input as Record<string, unknown> | undefined;
          if (!input) continue;
          const command = input.command as string | undefined;
          if (!command) continue;

          // Extract cd path if present
          let repoPath: string | null = null;
          const cdMatch = CD_REGEX.exec(command);
          if (cdMatch) {
            repoPath = resolveGitRoot(cdMatch[1]);
          }

          const addBranch = (branch: string) => {
            if (branch !== 'main' && branch !== 'master' && !branch.startsWith('-')) {
              const key = `${branch}::${repoPath ?? ''}`;
              if (!branchesSet.has(key)) {
                branchesSet.set(key, { branch, repoPath });
              }
            }
          };

          for (const match of command.matchAll(PUSH_REGEX)) {
            addBranch(match[1]);
          }
          for (const match of command.matchAll(CHECKOUT_BRANCH_REGEX)) {
            addBranch(match[1]);
          }
          for (const match of command.matchAll(SWITCH_CREATE_REGEX)) {
            addBranch(match[1]);
          }
          for (const match of command.matchAll(WORKTREE_ADD_REGEX)) {
            addBranch(match[1]);
          }
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    return Array.from(branchesSet.values()).sort((a, b) => a.branch.localeCompare(b.branch));
  }

  /** Scan a session JSONL bottom-up for the most recently pushed branch.
   *  Reads in reverse chunks and stops at the first match. */
  static async extractLatestPushedBranch(
    filePath: string,
    stopAtOffset: number = 0,
  ): Promise<DiscoveredBranch | null> {
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    if (fileSize <= stopAtOffset) return null;

    const fd = fs.openSync(filePath, 'r');
    try {
      const pushRegex = /git\s+push\s+(?:-[^\s]+\s+)*(?:origin|upstream)\s+(\S+)/;
      const cdRegex = /cd\s+([^\s;&]+)\s*&&/;

      const chunkSize = 256 * 1024;
      let trailingPartial = ''; // start of a line split by the chunk boundary
      let currentEnd = fileSize;

      while (currentEnd > stopAtOffset) {
        const readStart = Math.max(currentEnd - chunkSize, stopAtOffset);
        const readCount = currentEnd - readStart;

        const buffer = Buffer.alloc(readCount);
        fs.readSync(fd, buffer, 0, readCount, readStart);
        let chunkStr = buffer.toString('utf-8');

        // The trailing partial is the start of a line whose end was in the next chunk.
        chunkStr += trailingPartial;

        const lines = chunkStr.split('\n');

        // First element may be a partial line (unless we're at the start of the scan range)
        if (readStart > stopAtOffset) {
          trailingPartial = lines.shift()!;
        } else {
          trailingPartial = '';
        }

        // Process lines newest-first (reverse order)
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line || !line.includes('"tool_use"')) continue;

          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }

          const message = obj.message as Record<string, unknown> | undefined;
          if (!message) continue;
          const content = message.content;
          if (!Array.isArray(content)) continue;

          // Scan blocks in reverse too -- last tool_use in the message is most recent
          const blocks = content as Array<Record<string, unknown>>;
          for (let j = blocks.length - 1; j >= 0; j--) {
            const block = blocks[j];
            if (block.type !== 'tool_use' || block.name !== 'Bash') continue;

            const input = block.input as Record<string, unknown> | undefined;
            if (!input) continue;
            const command = input.command as string | undefined;
            if (!command) continue;

            let repoPath: string | null = null;
            const cdMatch = cdRegex.exec(command);
            if (cdMatch) {
              repoPath = resolveGitRoot(cdMatch[1]);
            }

            const pushMatch = pushRegex.exec(command);
            if (pushMatch) {
              const branch = pushMatch[1];
              if (branch !== 'main' && branch !== 'master' && !branch.startsWith('-')) {
                return { branch, repoPath };
              }
            }
          }
        }

        currentEnd = readStart;
      }

      return null;
    } finally {
      fs.closeSync(fd);
    }
  }

  // -----------------------------------------------------------------------
  // Metadata message detection
  // -----------------------------------------------------------------------

  /** True if this user message is purely internal metadata (skip for prompt extraction). */
  static isMetadataMessage(obj: Record<string, unknown>): boolean {
    if (obj.isMeta === true) return true;
    const text = JsonlParser.extractTextContent(obj);
    if (!text || text.length === 0) return false;
    const stripped = JsonlParser.stripMetadataTags(text);
    return stripped.trim().length === 0;
  }

  /** True only for isMeta: true messages (the local-command-caveat wrapper).
   *  These are hidden entirely from the History tab. */
  static isCaveatMessage(obj: Record<string, unknown>): boolean {
    return obj.isMeta === true;
  }

  /** True if this user message contains local-command-stdout output. */
  static isLocalCommandStdout(obj: Record<string, unknown>): boolean {
    const text = JsonlParser.extractTextContent(obj);
    if (!text) return false;
    return text.includes('<local-command-stdout>');
  }

  /** Extract command name from <command-name>/foo</command-name> -> /foo. */
  static parseLocalCommand(text: string): string | null {
    const regex = /<command-name>([\s\S]*?)<\/command-name>/;
    const match = text.match(regex);
    if (!match) return null;
    return match[1].trim();
  }

  /** Extract output text from <local-command-stdout>text</local-command-stdout>. */
  static parseLocalCommandStdout(text: string): string | null {
    const regex = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;
    const match = text.match(regex);
    if (!match) return null;
    return match[1].trim();
  }

  /** Remove all known metadata XML tag pairs, returning the remaining text. */
  static stripMetadataTags(text: string): string {
    return text.replace(METADATA_TAG_REGEX, '');
  }

  /** Decode a Claude projects directory name to a filesystem path.
   *  e.g., "-Users-rchaves-Projects-remote-langwatch" -> "/Users/rchaves/Projects/remote/langwatch" */
  static decodeDirectoryName(name: string): string {
    let result = name;
    if (result.startsWith('-')) {
      result = '/' + result.slice(1);
    }
    // Replace dashes that are path separators
    result = result.replace(/-/g, '/');
    return result;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Resolve a path to its likely git root.
 *  Strips .claude/worktrees/<name> suffix since worktrees are inside the repo. */
function resolveGitRoot(pathStr: string): string {
  const idx = pathStr.indexOf('/.claude/worktrees/');
  if (idx !== -1) {
    return pathStr.substring(0, idx);
  }
  return pathStr;
}
