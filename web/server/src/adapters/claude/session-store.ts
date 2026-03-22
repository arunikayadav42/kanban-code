/**
 * Implements SessionStore for Claude Code .jsonl files.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/ClaudeCode/ClaudeCodeSessionStore.swift
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import * as crypto from 'crypto';
import type { ConversationTurn, ContentBlock } from '@kanban-code/shared';
import type { SessionStore, SearchResult } from '../../domain/ports/session-store.js';
import { TranscriptReader } from './transcript-reader.js';
import { JsonlParser } from './jsonl-parser.js';

// ---------------------------------------------------------------------------
// BM25 Scorer (inlined from Swift: Sources/KanbanCodeCore/UseCases/BM25Scorer.swift)
// ---------------------------------------------------------------------------

const BM25_K1 = 1.2;
const BM25_B = 0.4;

/** Tokenize text into lowercase words (>= 2 chars, alphanumeric only). */
function bm25Tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

/** Score a document against query terms using BM25. */
function bm25Score(
  terms: string[],
  documentTokens: string[],
  avgDocLength: number,
  docCount: number,
  docFreqs: Map<string, number>,
  recencyBoost: number = 1.0,
): number {
  const docLength = documentTokens.length;
  if (docLength === 0 || avgDocLength === 0) return 0;

  // Build term frequency map for the document
  const tf = new Map<string, number>();
  for (const token of documentTokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  let totalScore = 0;

  for (const term of terms) {
    let termFreq: number;
    let dfCount: number;

    // Check for prefix match
    if (term.length >= 3) {
      termFreq = documentTokens.filter((t) => t.startsWith(term)).length;
      dfCount = 0;
      for (const [key, val] of docFreqs) {
        if (key.startsWith(term)) dfCount += val;
      }
    } else {
      termFreq = tf.get(term) ?? 0;
      dfCount = docFreqs.get(term) ?? 0;
    }

    if (termFreq === 0) continue;

    // IDF component
    const n = docCount;
    const df = Math.max(dfCount, 0.5);
    const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);

    // TF component with BM25 normalization
    const tfNorm =
      (termFreq * (BM25_K1 + 1)) /
      (termFreq + BM25_K1 * (1 - BM25_B + BM25_B * docLength / avgDocLength));

    totalScore += idf * tfNorm;
  }

  return totalScore * recencyBoost;
}

/** Calculate recency boost based on file modification time.
 *  Recent files get a stronger boost (up to 3x for today, decaying over 30 days). */
function bm25RecencyBoost(modifiedTime: Date): number {
  const daysAgo = (Date.now() - modifiedTime.getTime()) / 86400000;
  if (daysAgo <= 0) return 3.0;
  if (daysAgo >= 30) return 1.0;
  // Linear decay from 3.0 to 1.0 over 30 days
  return 3.0 - (2.0 * daysAgo) / 30.0;
}

// ---------------------------------------------------------------------------
// SessionStoreError
// ---------------------------------------------------------------------------

export class SessionStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'FILE_NOT_FOUND' | 'WRITE_NOT_SUPPORTED',
  ) {
    super(message);
    this.name = 'SessionStoreError';
  }

  static fileNotFound(path: string): SessionStoreError {
    return new SessionStoreError(`Session file not found: ${path}`, 'FILE_NOT_FOUND');
  }

  static writeNotSupported(): SessionStoreError {
    return new SessionStoreError('This session store does not support writing sessions', 'WRITE_NOT_SUPPORTED');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a project path for use as a directory name.
 *  Matches Claude CLI's encoding: replaces / with - and strips dots. */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-').replace(/\./g, '');
}

function generateUUID(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// ClaudeCodeSessionStore
// ---------------------------------------------------------------------------

export class ClaudeCodeSessionStore implements SessionStore {
  // -----------------------------------------------------------------------
  // readTranscript
  // -----------------------------------------------------------------------

  async readTranscript(sessionPath: string): Promise<ConversationTurn[]> {
    return TranscriptReader.readTurns(sessionPath);
  }

  // -----------------------------------------------------------------------
  // forkSession
  // -----------------------------------------------------------------------

  async forkSession(sessionPath: string, targetDirectory?: string | null): Promise<string> {
    if (!fs.existsSync(sessionPath)) {
      throw SessionStoreError.fileNotFound(sessionPath);
    }

    const newSessionId = generateUUID().toLowerCase();
    const dir = targetDirectory ?? path.dirname(sessionPath);

    if (targetDirectory && !fs.existsSync(targetDirectory)) {
      fs.mkdirSync(targetDirectory, { recursive: true });
    }

    const newPath = path.join(dir, `${newSessionId}.jsonl`);

    // Read, replace session IDs, write
    const oldSessionId = path.basename(sessionPath, '.jsonl');
    const content = fs.readFileSync(sessionPath, 'utf-8');
    const lines = content.split('\n');
    const replacedLines = lines.map((line) =>
      line.replace(new RegExp(`"${oldSessionId}"`, 'g'), `"${newSessionId}"`),
    );

    fs.writeFileSync(newPath, replacedLines.join('\n'), 'utf-8');

    // Preserve the original file's mtime so the activity detector
    // doesn't treat the fork as "actively working" (10-second window).
    try {
      const stat = fs.statSync(sessionPath);
      fs.utimesSync(newPath, stat.atime, stat.mtime);
    } catch {
      // Best-effort
    }

    return newSessionId;
  }

  // -----------------------------------------------------------------------
  // truncateSession
  // -----------------------------------------------------------------------

  async truncateSession(sessionPath: string, afterTurn: ConversationTurn): Promise<void> {
    if (!fs.existsSync(sessionPath)) {
      throw SessionStoreError.fileNotFound(sessionPath);
    }

    // Backup
    const backupPath = sessionPath + '.bkp';
    try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
    fs.copyFileSync(sessionPath, backupPath);

    // Read lines up to the target line number
    const stream = fs.createReadStream(sessionPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const keptLines: string[] = [];
    let lineNumber = 0;

    try {
      for await (const line of rl) {
        lineNumber += 1;
        keptLines.push(line);
        if (lineNumber >= afterTurn.lineNumber) {
          break;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    fs.writeFileSync(sessionPath, keptLines.join('\n'), 'utf-8');
  }

  // -----------------------------------------------------------------------
  // writeSession
  // -----------------------------------------------------------------------

  async writeSession(
    turns: ConversationTurn[],
    sessionId: string,
    projectPath?: string | null,
  ): Promise<string> {
    // Match Swift: default to ~/.claude/projects/-unknown — Swift: ClaudeCodeSessionStore.swift:66
    const dir = projectPath
      ? path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(projectPath))
      : path.join(os.homedir(), '.claude', 'projects', '-unknown');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${sessionId}.jsonl`);

    const lines: string[] = [];
    let lastUuid = '';

    for (const turn of turns) {
      const uuid = generateUUID().toLowerCase();
      const timestamp = turn.timestamp ?? new Date().toISOString();
      const type = turn.role === 'assistant' ? 'assistant' : 'user';

      const jsonObj: Record<string, unknown> = {
        type,
        sessionId,
        uuid,
        timestamp,
        isSidechain: false,
        userType: 'external',
      };

      if (lastUuid) {
        jsonObj.parentUuid = lastUuid;
      }
      if (projectPath) {
        jsonObj.cwd = projectPath;
      }

      if (turn.role === 'assistant') {
        const contentBlocks: Array<Record<string, unknown>> = [];
        const toolCalls: Array<{ id: string; name: string; resultText: string }> = [];

        for (const block of turn.contentBlocks) {
          switch (block.kind.type) {
            case 'text': {
              contentBlocks.push({ type: 'text', text: block.text });
              break;
            }
            case 'toolUse': {
              const kind = block.kind as { type: 'toolUse'; name: string; input: Record<string, string> };
              const toolId = `toolu_migrated_${generateUUID().substring(0, 8)}`;
              const claudeName = ClaudeCodeSessionStore.mapToolName(kind.name);
              contentBlocks.push({
                type: 'tool_use',
                id: toolId,
                name: claudeName,
                input: kind.input,
              });
              // Extract result from the block text (after " -> ")
              let resultText: string;
              const arrowIdx = block.text.indexOf(' -> ');
              if (arrowIdx !== -1) {
                resultText = block.text.substring(arrowIdx + 4);
              } else {
                resultText = '(migrated from another assistant)';
              }
              toolCalls.push({ id: toolId, name: claudeName, resultText });
              break;
            }
            case 'toolResult': {
              const kind = block.kind as { type: 'toolResult'; toolName: string | null };
              if (toolCalls.length > 0) {
                toolCalls[toolCalls.length - 1].resultText = block.text;
              } else {
                // Orphan tool result -- render as text
                const label = kind.toolName ?? 'tool';
                contentBlocks.push({ type: 'text', text: `[${label} result] ${block.text}` });
              }
              break;
            }
            case 'thinking': {
              // Skip thinking blocks in output
              break;
            }
          }
        }

        if (contentBlocks.length === 0) {
          contentBlocks.push({ type: 'text', text: turn.textPreview });
        }

        const hasToolUse = toolCalls.length > 0;
        const msgId = `msg_migrated_${generateUUID().substring(0, 12)}`;

        jsonObj.message = {
          id: msgId,
          type: 'message',
          role: 'assistant',
          content: contentBlocks,
          stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
          stop_sequence: null,
        };

        lines.push(JSON.stringify(jsonObj));
        lastUuid = uuid;

        // Emit tool_result lines (Claude expects a separate user message per tool_use)
        for (const tc of toolCalls) {
          const resultUuid = generateUUID().toLowerCase();
          const resultObj: Record<string, unknown> = {
            type: 'user',
            sessionId,
            uuid: resultUuid,
            parentUuid: lastUuid,
            timestamp,
            isSidechain: false,
            userType: 'external',
            sourceToolAssistantUUID: uuid,
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: tc.id,
                  content: tc.resultText,
                  is_error: false,
                },
              ],
            },
          };
          if (projectPath) {
            resultObj.cwd = projectPath;
          }
          lines.push(JSON.stringify(resultObj));
          lastUuid = resultUuid;
        }
      } else {
        // User or system message
        const textParts = turn.contentBlocks
          .map((block) => {
            if (block.kind.type === 'text') return block.text;
            if (block.kind.type === 'toolUse') {
              const kind = block.kind as { type: 'toolUse'; name: string; input: Record<string, string> };
              const args = Object.entries(kind.input)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
              return `[${kind.name}(${args})] ${block.text}`;
            }
            return null;
          })
          .filter((t): t is string => t !== null);

        const text =
          textParts.length === 0 ? turn.textPreview : textParts.join('\n');
        const prefix = turn.role === 'system' ? '[system] ' : '';
        jsonObj.message = { role: 'user', content: prefix + text };

        lines.push(JSON.stringify(jsonObj));
        lastUuid = uuid;
      }
    }

    const content = lines.join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  // -----------------------------------------------------------------------
  // Tool name mapping
  // -----------------------------------------------------------------------

  /** Map tool names from other assistants to Claude Code equivalents. */
  static mapToolName(name: string): string {
    switch (name.toLowerCase()) {
      case 'shell':
      case 'run_shell_command':
      case 'bash':
        return 'Bash';
      case 'readfile':
      case 'read_file':
      case 'read':
        return 'Read';
      case 'writefile':
      case 'write_file':
      case 'write':
        return 'Write';
      case 'editfile':
      case 'edit_file':
      case 'edit':
        return 'Edit';
      case 'glob':
      case 'listfiles':
      case 'list_files':
        return 'Glob';
      case 'grep':
      case 'search':
      case 'searchfiles':
        return 'Grep';
      default:
        return name; // Keep unknown names as-is
    }
  }

  // -----------------------------------------------------------------------
  // resolveSessionPath
  // -----------------------------------------------------------------------

  resolveSessionPath(sessionId: string, originalPath: string): string {
    return path.join(path.dirname(originalPath), sessionId + '.jsonl');
  }

  // -----------------------------------------------------------------------
  // searchSessions
  // -----------------------------------------------------------------------

  async searchSessions(query: string, paths: string[]): Promise<SearchResult[]> {
    let results: SearchResult[] = [];
    await this.searchSessionsStreaming(query, paths, (r) => {
      results = r;
    });
    return results;
  }

  // -----------------------------------------------------------------------
  // searchSessionsStreaming
  // -----------------------------------------------------------------------

  async searchSessionsStreaming(
    query: string,
    paths: string[],
    onResult: (results: SearchResult[]) => void,
  ): Promise<void> {
    const queryTerms = bm25Tokenize(query);
    if (queryTerms.length === 0) return;

    interface DocInfo {
      path: string;
      matchingTokens: string[];
      wordCount: number;
      snippets: string[];
      modifiedTime: Date;
    }

    const docs: DocInfo[] = [];
    const globalTermFreqs = new Map<string, number>();
    let totalWordCount = 0;

    // Filter to existing files and sort by modification time (newest first)
    const validPaths: Array<{ path: string; mtime: Date }> = [];
    for (const p of paths) {
      try {
        const stat = fs.statSync(p);
        validPaths.push({ path: p, mtime: stat.mtime });
      } catch {
        // Skip nonexistent files
      }
    }
    validPaths.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    for (const { path: filePath, mtime } of validPaths) {
      const { tokens, wordCount, snippets } = await this.extractMatchingTokens(
        filePath,
        queryTerms,
      );

      if (wordCount === 0) continue;

      totalWordCount += wordCount;

      // Only track and yield when file has matching tokens
      if (tokens.length === 0) continue;

      // Track global document frequencies
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        globalTermFreqs.set(term, (globalTermFreqs.get(term) ?? 0) + 1);
      }

      docs.push({
        path: filePath,
        matchingTokens: tokens,
        wordCount,
        snippets,
        modifiedTime: mtime,
      });

      // Score all matching docs with running stats and yield immediately
      const avgDocLength = totalWordCount / Math.max(docs.length, 1);
      const results: SearchResult[] = [];
      for (const doc of docs) {
        const boost = bm25RecencyBoost(doc.modifiedTime);
        const score = bm25Score(
          queryTerms,
          doc.matchingTokens,
          avgDocLength,
          docs.length,
          globalTermFreqs,
          boost,
        );
        if (score > 0) {
          results.push({ sessionPath: doc.path, score, snippets: doc.snippets });
        }
      }
      results.sort((a, b) => b.score - a.score);
      onResult(results);
    }
  }

  // -----------------------------------------------------------------------
  // Private: extractMatchingTokens
  // -----------------------------------------------------------------------

  private static readonly MAX_SNIPPETS = 3;

  private async extractMatchingTokens(
    filePath: string,
    queryTerms: string[],
  ): Promise<{ tokens: string[]; wordCount: number; snippets: string[] }> {
    let stream: fs.ReadStream;
    let rl: readline.Interface;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    } catch {
      return { tokens: [], wordCount: 0, snippets: [] };
    }

    const matchingTokens: string[] = [];
    let wordCount = 0;
    let topSnippets: Array<{ score: number; text: string }> = [];
    let lineCount = 0;

    try {
      for await (const line of rl) {
        lineCount += 1;

        // Fast string check -- skip lines that aren't user/assistant messages
        if (!line.includes('"type"')) continue;
        if (!line.includes('"user"') && !line.includes('"assistant"')) continue;

        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        const type = obj.type as string | undefined;
        if (type !== 'user' && type !== 'assistant') continue;

        const text = JsonlParser.extractTextContent(obj);
        if (!text) continue;

        // Tokenize and match -- only keep tokens that match query terms
        const docTokens = bm25Tokenize(text);
        wordCount += docTokens.length;

        for (const token of docTokens) {
          const matched = matchQueryTerm(token, queryTerms);
          if (matched) {
            matchingTokens.push(matched);
          }
        }

        // Track top snippets by number of matching query terms
        const lower = text.toLowerCase();
        let snippetScore = 0;
        for (const qt of queryTerms) {
          if (lower.includes(qt)) snippetScore += 1;
        }
        if (snippetScore > 0) {
          const snippet = extractSnippet(text, queryTerms, type);
          if (topSnippets.length < ClaudeCodeSessionStore.MAX_SNIPPETS) {
            topSnippets.push({ score: snippetScore, text: snippet });
            topSnippets.sort((a, b) => b.score - a.score);
          } else if (snippetScore > topSnippets[topSnippets.length - 1].score) {
            topSnippets[topSnippets.length - 1] = { score: snippetScore, text: snippet };
            topSnippets.sort((a, b) => b.score - a.score);
          }
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    return { tokens: matchingTokens, wordCount, snippets: topSnippets.map((s) => s.text) };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Check if a document token matches any query term (exact or prefix match). */
function matchQueryTerm(token: string, queryTerms: string[]): string | null {
  for (const qt of queryTerms) {
    if (token === qt || token.startsWith(qt) || qt.startsWith(token)) {
      return qt; // normalize to query term for TF counting
    }
  }
  return null;
}

/** Extract a snippet around the first query term match in text. */
function extractSnippet(text: string, queryTerms: string[], role: string): string {
  const lower = text.toLowerCase();
  for (const qt of queryTerms) {
    const idx = lower.indexOf(qt);
    if (idx !== -1) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + qt.length + 60);
      const prefix = start > 0 ? '...' : '';
      const suffix = end < text.length ? '...' : '';
      const snippet = text.substring(start, end).replace(/\n/g, ' ');
      const label = role === 'user' ? 'You' : 'Claude';
      return `${label}: ${prefix}${snippet}${suffix}`;
    }
  }
  return text.substring(0, 100);
}
