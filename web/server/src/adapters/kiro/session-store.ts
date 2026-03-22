import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import type { ConversationTurn, ContentBlock } from '@kanban-code/shared';
import type { SessionStore, SearchResult } from '../../domain/ports/session-store.js';
import { KiroSessionParser } from './session-parser.js';

/**
 * Implements SessionStore for Kiro CLI conversations stored in SQLite.
 *
 * sessionPath format: "kiro-sqlite://<conversation_id>" or an override dbPath
 * for testing. The constructor accepts an optional dbPath override.
 */

class KiroStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KiroStoreError';
  }
}

// MARK: - BM25 Scorer (same algorithm as Gemini adapter)

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

  const tf: Record<string, number> = {};
  for (const token of documentTokens) {
    tf[token] = (tf[token] ?? 0) + 1;
  }

  let totalScore = 0;

  for (const term of terms) {
    let termFreq: number;
    let dfCount: number;

    if (term.length >= 3) {
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

// MARK: - Helpers

/** Extract conversation_id from a kiro-sqlite:// path. */
function parseSessionPath(sessionPath: string): string {
  const prefix = 'kiro-sqlite://';
  if (sessionPath.startsWith(prefix)) {
    return sessionPath.substring(prefix.length);
  }
  return sessionPath;
}

const MAX_SNIPPETS = 3;

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
      const label = role === 'user' ? 'You' : 'Kiro';
      return `${label}: ${prefix}${snippetText}${suffix}`;
    }
  }
  return text.substring(0, 100);
}

// MARK: - Store Implementation

export class KiroSessionStore implements SessionStore {
  private readonly dbPath: string;

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

  private openDb(readonly = true): Database.Database {
    if (!fs.existsSync(this.dbPath)) {
      throw new KiroStoreError(`Database not found: ${this.dbPath}`);
    }
    return new Database(this.dbPath, { readonly, fileMustExist: true });
  }

  async readTranscript(sessionPath: string): Promise<ConversationTurn[]> {
    const conversationId = parseSessionPath(sessionPath);
    const db = this.openDb();

    try {
      const row = db.prepare(
        'SELECT value FROM conversations_v2 WHERE conversation_id = ?',
      ).get(conversationId) as { value: string } | undefined;

      if (!row) {
        throw new KiroStoreError(`Conversation not found: ${conversationId}`);
      }

      const conversation = KiroSessionParser.parseConversation(row.value);
      if (!conversation) return [];

      return KiroSessionParser.toConversationTurns(conversation);
    } finally {
      db.close();
    }
  }

  async forkSession(
    sessionPath: string,
    _targetDirectory?: string | null,
  ): Promise<string> {
    const conversationId = parseSessionPath(sessionPath);
    const db = this.openDb(false);

    try {
      const row = db.prepare(
        'SELECT key, value, created_at FROM conversations_v2 WHERE conversation_id = ?',
      ).get(conversationId) as { key: string; value: string; created_at: string } | undefined;

      if (!row) {
        throw new KiroStoreError(`Conversation not found: ${conversationId}`);
      }

      const newConversationId = crypto.randomUUID();
      const newValue = row.value.replaceAll(
        `"${conversationId}"`,
        `"${newConversationId}"`,
      );
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO conversations_v2 (key, conversation_id, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(row.key, newConversationId, newValue, now, now);

      return newConversationId;
    } finally {
      db.close();
    }
  }

  async writeSession(
    turns: ConversationTurn[],
    sessionId: string,
    projectPath?: string | null,
  ): Promise<string> {
    const db = this.openDb(false);

    try {
      const history: Record<string, unknown>[] = [];
      const now = new Date().toISOString();

      // Pair turns into user+assistant history entries
      for (let i = 0; i < turns.length; i += 2) {
        const userTurn = turns[i];
        const assistantTurn = turns[i + 1];
        if (!userTurn) break;

        const userText = userTurn.contentBlocks
          .filter(b => b.kind.type === 'text')
          .map(b => b.text)
          .join('\n') || userTurn.textPreview;

        const entry: Record<string, unknown> = {
          user: {
            content: { Prompt: { prompt: userText } },
            timestamp: userTurn.timestamp ?? now,
            images: [],
          },
          assistant: assistantTurn
            ? buildAssistantJson(assistantTurn)
            : { Response: { message_id: crypto.randomUUID(), content: '' } },
        };

        history.push(entry);
      }

      const conversation = {
        conversation_id: sessionId,
        history,
      };

      const value = JSON.stringify(conversation);
      const key = projectPath ?? '';

      db.prepare(
        `INSERT OR REPLACE INTO conversations_v2 (key, conversation_id, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(key, sessionId, value, now, now);

      return `kiro-sqlite://${sessionId}`;
    } finally {
      db.close();
    }
  }

  async truncateSession(
    sessionPath: string,
    afterTurn: ConversationTurn,
  ): Promise<void> {
    const conversationId = parseSessionPath(sessionPath);
    const db = this.openDb(false);

    try {
      const row = db.prepare(
        'SELECT value FROM conversations_v2 WHERE conversation_id = ?',
      ).get(conversationId) as { value: string } | undefined;

      if (!row) {
        throw new KiroStoreError(`Conversation not found: ${conversationId}`);
      }

      const conversation = KiroSessionParser.parseConversation(row.value);
      if (!conversation) return;

      // lineNumber is 1-based turn index. Each history entry produces 2 turns.
      // Keep history entries up to ceil(lineNumber / 2).
      const keepEntries = Math.min(
        Math.ceil(afterTurn.lineNumber / 2),
        conversation.history.length,
      );

      const truncated = {
        conversation_id: conversation.conversation_id,
        history: conversation.history.slice(0, keepEntries),
      };

      const newValue = JSON.stringify(truncated);
      const now = new Date().toISOString();

      db.prepare(
        'UPDATE conversations_v2 SET value = ?, updated_at = ? WHERE conversation_id = ?',
      ).run(newValue, now, conversationId);
    } finally {
      db.close();
    }
  }

  resolveSessionPath(sessionId: string, _originalPath: string): string {
    return 'kiro-sqlite://' + sessionId;
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

    const db = this.openDb();

    try {
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

      for (const sessionPath of paths) {
        const conversationId = parseSessionPath(sessionPath);

        const row = db.prepare(
          'SELECT value, updated_at FROM conversations_v2 WHERE conversation_id = ?',
        ).get(conversationId) as { value: string; updated_at: string } | undefined;

        if (!row) continue;

        const conversation = KiroSessionParser.parseConversation(row.value);
        if (!conversation) continue;

        const fullText = KiroSessionParser.getFullText(conversation);
        const docTokens = bm25Tokenize(fullText);
        const wordCount = docTokens.length;
        if (wordCount === 0) continue;

        totalWordCount += wordCount;

        const matchingTokens: string[] = [];
        for (const token of docTokens) {
          for (const qt of queryTerms) {
            if (token === qt || token.startsWith(qt) || qt.startsWith(token)) {
              matchingTokens.push(qt);
              break;
            }
          }
        }

        if (matchingTokens.length === 0) continue;

        const uniqueTerms = new Set(matchingTokens);
        for (const term of uniqueTerms) {
          globalTermFreqs[term] = (globalTermFreqs[term] ?? 0) + 1;
        }

        // Collect snippets
        const topSnippets: Array<{ score: number; text: string }> = [];
        for (const entry of conversation.history) {
          const texts: Array<{ text: string; role: string }> = [];

          if ('Prompt' in entry.user.content) {
            texts.push({ text: entry.user.content.Prompt.prompt, role: 'user' });
          }
          if ('Response' in entry.assistant) {
            texts.push({ text: entry.assistant.Response.content, role: 'assistant' });
          }

          for (const { text, role } of texts) {
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
        }

        const modifiedTime = new Date(row.updated_at);

        docs.push({
          path: sessionPath,
          matchingTokens,
          wordCount,
          snippets: topSnippets.map(s => s.text),
          modifiedTime,
        });

        // Score all docs and yield
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
    } finally {
      db.close();
    }
  }
}

// MARK: - Helpers

function buildAssistantJson(turn: ConversationTurn): Record<string, unknown> {
  const textBlocks = turn.contentBlocks.filter(b => b.kind.type === 'text');
  const toolBlocks = turn.contentBlocks.filter(b => b.kind.type === 'toolUse');

  if (toolBlocks.length > 0) {
    const kind = toolBlocks[0].kind as { type: 'toolUse'; name: string; input: Record<string, string> };
    return {
      ToolUse: {
        tool_use_id: crypto.randomUUID(),
        name: kind.name,
        input: kind.input,
      },
    };
  }

  const text = textBlocks.map(b => b.text).join('\n') || turn.textPreview;
  return {
    Response: {
      message_id: crypto.randomUUID(),
      content: text,
    },
  };
}
