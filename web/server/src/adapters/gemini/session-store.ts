import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { ConversationTurn, ContentBlock, ContentBlockKind } from '@kanban-code/shared';
import type { SessionStore, SearchResult } from '../../domain/ports/session-store.js';
import { GeminiSessionParser } from './session-parser.js';

/**
 * Implements SessionStore for Gemini CLI JSON session files.
 *
 * Swift source: Sources/KanbanCodeCore/Adapters/Gemini/GeminiSessionStore.swift
 */

class SessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionStoreError';
  }
}

// MARK: - BM25 Scorer (inlined, mirrors BM25Scorer.swift)

const BM25_K1 = 1.2;
const BM25_B = 0.4;

function bm25Tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2);
}

function bm25Score(
  terms: string[],
  documentTokens: string[],
  avgDocLength: number,
  docCount: number,
  docFreqs: Record<string, number>,
  recencyBoost = 1.0,
): number {
  const docLength = documentTokens.length;
  if (docLength === 0 || avgDocLength === 0) return 0;

  // Build term frequency map
  const tf: Record<string, number> = {};
  for (const token of documentTokens) {
    tf[token] = (tf[token] ?? 0) + 1;
  }

  let totalScore = 0;

  for (const term of terms) {
    let termFreq: number;
    let dfCount: number;

    if (term.length >= 3) {
      // Prefix matching
      termFreq = documentTokens.filter(t => t.startsWith(term)).length;
      dfCount = Object.entries(docFreqs)
        .filter(([k]) => k.startsWith(term))
        .reduce((sum, [, v]) => sum + v, 0);
    } else {
      termFreq = tf[term] ?? 0;
      dfCount = docFreqs[term] ?? 0;
    }

    if (termFreq === 0) continue;

    const n = docCount;
    const df = Math.max(dfCount, 0.5);
    const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);
    const tfNorm =
      (termFreq * (BM25_K1 + 1)) /
      (termFreq + BM25_K1 * (1 - BM25_B + BM25_B * docLength / avgDocLength));

    totalScore += idf * tfNorm;
  }

  return totalScore * recencyBoost;
}

function bm25RecencyBoost(modifiedTime: Date): number {
  const daysAgo = (Date.now() - modifiedTime.getTime()) / 86_400_000;
  if (daysAgo <= 0) return 3.0;
  if (daysAgo >= 30) return 1.0;
  return 3.0 - (2.0 * daysAgo) / 30.0;
}

// MARK: - Store Implementation

export class GeminiSessionStore implements SessionStore {
  async readTranscript(sessionPath: string): Promise<ConversationTurn[]> {
    if (!fs.existsSync(sessionPath)) {
      throw new SessionStoreError(`File not found: ${sessionPath}`);
    }

    const session = GeminiSessionParser.parseSession(sessionPath);
    if (!session) return [];

    const turns: ConversationTurn[] = [];
    let turnIndex = 0;

    for (let messageIndex = 0; messageIndex < session.messages.length; messageIndex++) {
      const message = session.messages[messageIndex];

      let role: string;
      switch (message.type) {
        case 'user':
          role = 'user';
          break;
        case 'gemini':
          role = 'assistant';
          break;
        case 'info':
        case 'error':
          role = 'system';
          break;
        default:
          continue;
      }

      const blocks: ContentBlock[] = [];

      // Main content
      const textContent = GeminiSessionParser.getTextValue(message.content);
      if (textContent.length > 0) {
        blocks.push({ kind: { type: 'text' }, text: textContent });
      }

      // Thinking/reasoning blocks
      if (message.thoughts) {
        for (const thought of message.thoughts) {
          if (thought.text && thought.text.length > 0) {
            blocks.push({
              kind: { type: 'thinking' },
              text: thought.text.substring(0, 500),
            });
          }
        }
      }

      // Tool calls
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          const name = call.displayName ?? call.name ?? 'unknown';
          const inputMap = call.args ?? {};
          const description = call.description ?? name;

          let resultPreview = '';
          if (call.result) {
            const lines = call.result.split('\n');
            resultPreview =
              lines.length > 1
                ? ` -> (${lines.length} lines)`
                : ` -> ${call.result.substring(0, 100)}`;
          }

          blocks.push({
            kind: { type: 'toolUse', name, input: inputMap },
            text: `${description}${resultPreview}`,
          });

          // Add tool result block with full output for migration support
          if (call.result) {
            blocks.push({
              kind: { type: 'toolResult', toolName: name },
              text: call.result,
            });
          }
        }
      }

      const textPreview = buildTextPreview(blocks, role);

      turns.push({
        index: turnIndex,
        lineNumber: messageIndex + 1, // 1-based for consistency
        role,
        textPreview,
        timestamp: message.timestamp ?? null,
        contentBlocks: blocks,
      });
      turnIndex++;
    }

    return turns;
  }

  async forkSession(
    sessionPath: string,
    targetDirectory?: string | null,
  ): Promise<string> {
    if (!fs.existsSync(sessionPath)) {
      throw new SessionStoreError(`File not found: ${sessionPath}`);
    }

    const newSessionId = crypto.randomUUID();
    const dir = targetDirectory ?? path.dirname(sessionPath);

    if (targetDirectory && !fs.existsSync(targetDirectory)) {
      fs.mkdirSync(targetDirectory, { recursive: true });
    }

    // Parse, replace sessionId, write new file
    const data = fs.readFileSync(sessionPath, 'utf-8');
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const oldSessionId = parsed.sessionId as string;

    const jsonString = data.replaceAll(`"${oldSessionId}"`, `"${newSessionId}"`);

    const newFileName = `session-forked-${newSessionId}.json`;
    const newPath = path.join(dir, newFileName);

    fs.writeFileSync(newPath, jsonString, 'utf-8');

    // Preserve original mtime so activity detector doesn't treat fork as active
    try {
      const stat = fs.statSync(sessionPath);
      fs.utimesSync(newPath, stat.atime, stat.mtime);
    } catch {
      // best-effort
    }

    return newSessionId;
  }

  async writeSession(
    turns: ConversationTurn[],
    sessionId: string,
    projectPath?: string | null,
    geminiDir?: string,
  ): Promise<string> {
    const gDir = geminiDir ?? path.join(os.homedir(), '.gemini');
    const slug = resolveSlug(projectPath ?? null, gDir);
    const base = path.join(gDir, 'tmp', slug, 'chats');
    fs.mkdirSync(base, { recursive: true });

    const fileName = `session-migrated-${sessionId}.json`;
    const filePath = path.join(base, fileName);

    const now = new Date().toISOString();
    const messages: Record<string, unknown>[] = [];

    for (const turn of turns) {
      const msgId = crypto.randomUUID();
      const msg: Record<string, unknown> = {
        id: msgId,
        timestamp: turn.timestamp ?? now,
      };

      if (turn.role === 'user') {
        msg.type = 'user';
        const textParts = turn.contentBlocks
          .filter(b => b.kind.type === 'text')
          .map(b => b.text);
        const text = textParts.length === 0 ? turn.textPreview : textParts.join('\n');
        msg.content = [{ text }];
      } else if (turn.role === 'assistant') {
        msg.type = 'gemini';
        const textParts: string[] = [];
        const toolCalls: Record<string, unknown>[] = [];

        for (const block of turn.contentBlocks) {
          switch (block.kind.type) {
            case 'text':
              textParts.push(block.text);
              break;
            case 'toolUse':
              toolCalls.push({
                id: crypto.randomUUID(),
                name: block.kind.name,
                displayName: block.kind.name,
                description: block.text,
                args: block.kind.input,
                status: 'completed',
              });
              break;
            case 'toolResult':
              // Attach result to last tool call if possible
              if (toolCalls.length > 0) {
                toolCalls[toolCalls.length - 1].result = block.text;
              }
              break;
            case 'thinking':
              // Skip thinking blocks
              break;
          }
        }

        msg.content = textParts.join('\n');
        if (toolCalls.length > 0) {
          msg.toolCalls = toolCalls;
        }
      } else {
        // System message -> info type
        const text = turn.contentBlocks
          .filter(b => b.kind.type === 'text')
          .map(b => b.text)
          .join('\n');
        msg.type = 'info';
        msg.content = text.length > 0 ? text : turn.textPreview;
      }

      messages.push(msg);
    }

    const sessionObj = {
      kind: 'main',
      lastUpdated: turns[turns.length - 1]?.timestamp ?? now,
      messages,
      sessionId,
      startTime: turns[0]?.timestamp ?? now,
    };

    const data = JSON.stringify(sessionObj, null, 2);
    fs.writeFileSync(filePath, data, 'utf-8');
    return filePath;
  }

  async truncateSession(
    sessionPath: string,
    afterTurn: ConversationTurn,
  ): Promise<void> {
    if (!fs.existsSync(sessionPath)) {
      throw new SessionStoreError(`File not found: ${sessionPath}`);
    }

    // Backup
    const backupPath = sessionPath + '.bkp';
    try { fs.rmSync(backupPath, { force: true }); } catch { /* ignore */ }
    fs.copyFileSync(sessionPath, backupPath);

    // Parse, truncate messages, write back
    const data = fs.readFileSync(sessionPath, 'utf-8');
    const obj = JSON.parse(data) as Record<string, unknown>;
    const messages = obj.messages;
    if (!Array.isArray(messages)) return;

    // lineNumber is 1-based message index, so keep messages[0..<lineNumber]
    const keepCount = Math.min(afterTurn.lineNumber, messages.length);
    obj.messages = messages.slice(0, keepCount);

    const truncatedData = JSON.stringify(obj, null, 2);
    fs.writeFileSync(sessionPath, truncatedData, 'utf-8');
  }

  resolveSessionPath(sessionId: string, originalPath: string): string {
    return path.join(path.dirname(originalPath), 'session-forked-' + sessionId + '.json');
  }

  async searchSessions(
    query: string,
    paths: string[],
  ): Promise<SearchResult[]> {
    let results: SearchResult[] = [];
    await this.searchSessionsStreaming(query, paths, (r) => {
      results = r;
    });
    return results;
  }

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
    const globalTermFreqs: Record<string, number> = {};
    let totalWordCount = 0;

    // Filter to existing files and sort by modification time (newest first)
    const validPaths: Array<{ path: string; mtime: Date }> = paths
      .map(p => {
        try {
          const stat = fs.statSync(p);
          return { path: p, mtime: stat.mtime };
        } catch {
          return null;
        }
      })
      .filter((v): v is { path: string; mtime: Date } => v !== null)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    for (const { path: filePath, mtime } of validPaths) {
      const { tokens: matchingTokens, wordCount, snippets } =
        extractMatchingTokens(filePath, queryTerms);

      if (wordCount === 0) continue;
      totalWordCount += wordCount;
      if (matchingTokens.length === 0) continue;

      const uniqueTerms = new Set(matchingTokens);
      for (const term of uniqueTerms) {
        globalTermFreqs[term] = (globalTermFreqs[term] ?? 0) + 1;
      }

      docs.push({ path: filePath, matchingTokens, wordCount, snippets, modifiedTime: mtime });

      // Score all matching docs with running stats and yield
      const avgDocLength = totalWordCount / Math.max(docs.length, 1);
      let results: SearchResult[] = [];
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
}

// MARK: - Search Helpers

const MAX_SNIPPETS = 3;

function extractMatchingTokens(
  filePath: string,
  queryTerms: string[],
): { tokens: string[]; wordCount: number; snippets: string[] } {
  let data: string;
  try {
    data = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { tokens: [], wordCount: 0, snippets: [] };
  }

  let session;
  try {
    session = GeminiSessionParser.parseSession(filePath);
  } catch {
    return { tokens: [], wordCount: 0, snippets: [] };
  }
  if (!session) return { tokens: [], wordCount: 0, snippets: [] };

  const matchingTokens: string[] = [];
  let wordCount = 0;
  const topSnippets: Array<{ score: number; text: string }> = [];

  for (const message of session.messages) {
    const text = GeminiSessionParser.getTextValue(message.content);
    if (text.length === 0) continue;

    let role: string;
    switch (message.type) {
      case 'user': role = 'user'; break;
      case 'gemini': role = 'assistant'; break;
      default: role = 'system'; break;
    }

    const docTokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 2);

    wordCount += docTokens.length;

    for (const token of docTokens) {
      const matched = matchQueryTerm(token, queryTerms);
      if (matched) matchingTokens.push(matched);
    }

    // Track top snippets
    const lower = text.toLowerCase();
    let snippetScore = 0;
    for (const qt of queryTerms) {
      if (lower.includes(qt)) snippetScore++;
    }
    if (snippetScore > 0) {
      const snippet = extractSnippet(text, queryTerms, role);
      if (topSnippets.length < MAX_SNIPPETS) {
        topSnippets.push({ score: snippetScore, text: snippet });
        topSnippets.sort((a, b) => b.score - a.score);
      } else if (snippetScore > topSnippets[topSnippets.length - 1].score) {
        topSnippets[topSnippets.length - 1] = { score: snippetScore, text: snippet };
        topSnippets.sort((a, b) => b.score - a.score);
      }
    }
  }

  return { tokens: matchingTokens, wordCount, snippets: topSnippets.map(s => s.text) };
}

function matchQueryTerm(token: string, queryTerms: string[]): string | null {
  for (const qt of queryTerms) {
    if (token === qt || token.startsWith(qt) || qt.startsWith(token)) {
      return qt;
    }
  }
  return null;
}

function extractSnippet(text: string, queryTerms: string[], role: string): string {
  const lower = text.toLowerCase();
  for (const qt of queryTerms) {
    const idx = lower.indexOf(qt);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + qt.length + 60);
      const prefix = start > 0 ? '...' : '';
      const suffix = end < text.length ? '...' : '';
      const snippetText = text.substring(start, end).replace(/\n/g, ' ');
      const label = role === 'user' ? 'You' : 'Gemini';
      return `${label}: ${prefix}${snippetText}${suffix}`;
    }
  }
  return text.substring(0, 100);
}

// MARK: - Text Preview

function buildTextPreview(blocks: ContentBlock[], role: string): string {
  const textOnly = blocks
    .filter(b => b.kind.type === 'text')
    .map(b => b.text)
    .join('\n');

  if (textOnly.length > 0) {
    return textOnly.substring(0, 500);
  }

  if (blocks.length === 0) return '(empty)';

  if (role === 'user') {
    const resultCount = blocks.filter(b => b.kind.type === 'toolResult').length;
    if (resultCount > 0) {
      return `[tool result x${resultCount}]`;
    }
  } else {
    const toolNames = blocks
      .filter((b): b is ContentBlock & { kind: { type: 'toolUse'; name: string } } =>
        b.kind.type === 'toolUse'
      )
      .map(b => (b.kind as { type: 'toolUse'; name: string }).name);

    if (toolNames.length > 0) {
      const unique = [...new Set(toolNames)];
      return `[tool: ${unique.join(', ')}]`;
    }
  }

  return '(empty)';
}

// MARK: - Slug Resolution

function resolveSlug(projectPath: string | null, geminiDir: string): string {
  if (!projectPath) return 'unknown';

  const projectsJsonPath = path.join(geminiDir, 'projects.json');
  try {
    const data = fs.readFileSync(projectsJsonPath, 'utf-8');
    const parsed = JSON.parse(data) as { projects?: Record<string, string> };
    if (parsed.projects) {
      const slug = parsed.projects[projectPath];
      if (slug) return slug;
    }
  } catch {
    // Fall through
  }

  // Not found -- derive from path
  return path.basename(projectPath);
}


