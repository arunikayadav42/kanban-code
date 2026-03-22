import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { KiroSessionStore } from '../session-store.js';
import type { ConversationTurn } from '@kanban-code/shared';

describe('KiroSessionStore', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-kiro-store-'));
    dbPath = path.join(tempDir, 'data.sqlite3');
    createDb();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createDb(): void {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations_v2 (
        key TEXT NOT NULL,
        conversation_id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.close();
  }

  function insertConversation(
    conversationId: string,
    value: string,
    key = '/Users/dev/project',
  ): void {
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversations_v2 (key, conversation_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(key, conversationId, value, now, now);
    db.close();
  }

  const sampleConversation = JSON.stringify({
    conversation_id: 'store-test-1',
    history: [
      {
        user: {
          content: { Prompt: { prompt: 'Fix the bug' } },
          timestamp: '2025-01-15T10:00:00Z',
          images: [],
        },
        assistant: {
          Response: { message_id: 'msg-001', content: "I'll fix it." },
        },
        request_metadata: { model_id: 'claude-sonnet-4-20250514' },
      },
      {
        user: {
          content: { Prompt: { prompt: 'Now add tests' } },
          timestamp: '2025-01-15T10:01:00Z',
          images: [],
        },
        assistant: {
          ToolUse: {
            tool_use_id: 'tu-001',
            name: 'editFile',
            input: { path: 'src/test.ts' },
          },
        },
      },
      {
        user: {
          content: {
            ToolUseResults: {
              results: [{ tool_use_id: 'tu-001', content: 'File created', is_error: false }],
            },
          },
          timestamp: '2025-01-15T10:02:00Z',
          images: [],
        },
        assistant: {
          Response: { message_id: 'msg-003', content: 'Tests added successfully.' },
        },
      },
    ],
  });

  // -- Read Transcript --

  describe('readTranscript', () => {
    it('reads transcript from SQLite conversation', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      // 3 history entries * 2 turns each = 6
      expect(turns).toHaveLength(6);
    });

    it('maps roles correctly', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
      expect(turns[2].role).toBe('user');
      expect(turns[3].role).toBe('assistant');
      expect(turns[4].role).toBe('user');
      expect(turns[5].role).toBe('assistant');
    });

    it('extracts text content from user Prompt turns', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      expect(turns[0].textPreview).toBe('Fix the bug');
      expect(turns[2].textPreview).toBe('Now add tests');
    });

    it('extracts text content from assistant Response turns', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      expect(turns[1].textPreview).toBe("I'll fix it.");
    });

    it('includes toolUse content blocks in assistant turns', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      const toolTurn = turns[3]; // second assistant turn (ToolUse)
      const toolBlocks = toolTurn.contentBlocks.filter(b => b.kind.type === 'toolUse');
      expect(toolBlocks).toHaveLength(1);
      const kind = toolBlocks[0].kind;
      if (kind.type === 'toolUse') {
        expect(kind.name).toBe('editFile');
        expect(kind.input.path).toBe('src/test.ts');
      }
    });

    it('includes toolResult blocks in user ToolUseResults turns', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      const resultTurn = turns[4]; // third user turn (ToolUseResults)
      expect(resultTurn.contentBlocks).toHaveLength(1);
      expect(resultTurn.contentBlocks[0].kind.type).toBe('toolResult');
    });

    it('turn indices are sequential', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      for (let i = 0; i < turns.length; i++) {
        expect(turns[i].index).toBe(i);
      }
    });

    it('line numbers are 1-based', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      expect(turns[0].lineNumber).toBe(1);
      expect(turns[1].lineNumber).toBe(2);
      expect(turns[2].lineNumber).toBe(3);
    });

    it('throws for non-existent conversation', async () => {
      const store = new KiroSessionStore(dbPath);
      await expect(
        store.readTranscript('kiro-sqlite://nonexistent'),
      ).rejects.toThrow('Conversation not found');
    });

    it('throws for non-existent database', async () => {
      const store = new KiroSessionStore('/nonexistent/data.sqlite3');
      await expect(
        store.readTranscript('kiro-sqlite://test'),
      ).rejects.toThrow('Database not found');
    });
  });

  // -- Fork Session --

  describe('forkSession', () => {
    it('fork creates new conversation with new ID', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const newId = await store.forkSession('kiro-sqlite://store-test-1');

      expect(newId).toBeTruthy();
      expect(newId).not.toBe('store-test-1');

      // Verify new row exists in database
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare(
        'SELECT conversation_id FROM conversations_v2 WHERE conversation_id = ?',
      ).get(newId) as { conversation_id: string } | undefined;
      db.close();

      expect(row).toBeDefined();
      expect(row!.conversation_id).toBe(newId);
    });

    it('forked conversation has replaced conversation_id in value', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const newId = await store.forkSession('kiro-sqlite://store-test-1');

      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare(
        'SELECT value FROM conversations_v2 WHERE conversation_id = ?',
      ).get(newId) as { value: string };
      db.close();

      expect(row.value).toContain(newId);
      expect(row.value).not.toContain('store-test-1');
    });

    it('fork preserves the key (project path)', async () => {
      insertConversation('store-test-1', sampleConversation, '/Users/dev/my-project');

      const store = new KiroSessionStore(dbPath);
      const newId = await store.forkSession('kiro-sqlite://store-test-1');

      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare(
        'SELECT key FROM conversations_v2 WHERE conversation_id = ?',
      ).get(newId) as { key: string };
      db.close();

      expect(row.key).toBe('/Users/dev/my-project');
    });

    it('fork throws for non-existent conversation', async () => {
      const store = new KiroSessionStore(dbPath);
      await expect(
        store.forkSession('kiro-sqlite://nonexistent'),
      ).rejects.toThrow('Conversation not found');
    });
  });

  // -- Truncate Session --

  describe('truncateSession', () => {
    it('truncate keeps only first N history entries', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      // Truncate after turn at lineNumber 2 (the first assistant turn).
      // ceil(2/2)=1 history entry kept.
      await store.truncateSession('kiro-sqlite://store-test-1', turns[1]);

      const truncated = await store.readTranscript('kiro-sqlite://store-test-1');
      // 1 history entry * 2 turns = 2
      expect(truncated).toHaveLength(2);
      expect(truncated[0].role).toBe('user');
      expect(truncated[1].role).toBe('assistant');
    });

    it('truncate after first user turn keeps 1 entry', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const turns = await store.readTranscript('kiro-sqlite://store-test-1');

      // Truncate after lineNumber 1: ceil(1/2)=1 entry
      await store.truncateSession('kiro-sqlite://store-test-1', turns[0]);

      const truncated = await store.readTranscript('kiro-sqlite://store-test-1');
      expect(truncated).toHaveLength(2); // 1 history entry = 2 turns
    });

    it('truncate throws for non-existent conversation', async () => {
      const store = new KiroSessionStore(dbPath);
      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 1,
        role: 'user',
        textPreview: 'test',
        contentBlocks: [],
      };
      await expect(
        store.truncateSession('kiro-sqlite://nonexistent', turn),
      ).rejects.toThrow('Conversation not found');
    });
  });

  // -- Search Sessions --

  describe('searchSessions', () => {
    it('search finds matching conversations', async () => {
      const conv1 = JSON.stringify({
        conversation_id: 'search-1',
        history: [
          {
            user: {
              content: { Prompt: { prompt: 'Fix the login validation bug' } },
              timestamp: '2025-01-15T10:00:00Z',
            },
            assistant: {
              Response: { message_id: 'msg-001', content: "I'll fix the validation." },
            },
          },
        ],
      });
      const conv2 = JSON.stringify({
        conversation_id: 'search-2',
        history: [
          {
            user: {
              content: { Prompt: { prompt: 'Add dark mode support' } },
              timestamp: '2025-01-15T10:00:00Z',
            },
            assistant: {
              Response: { message_id: 'msg-002', content: 'Adding dark mode.' },
            },
          },
        ],
      });

      insertConversation('search-1', conv1);
      insertConversation('search-2', conv2);

      const store = new KiroSessionStore(dbPath);
      const results = await store.searchSessions('login validation', [
        'kiro-sqlite://search-1',
        'kiro-sqlite://search-2',
      ]);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].sessionPath).toBe('kiro-sqlite://search-1');
    });

    it('search returns empty for no matches', async () => {
      const conv = JSON.stringify({
        conversation_id: 'search-nomatch',
        history: [
          {
            user: {
              content: { Prompt: { prompt: 'Hello world' } },
              timestamp: '2025-01-15T10:00:00Z',
            },
            assistant: {
              Response: { message_id: 'msg-001', content: 'Hi' },
            },
          },
        ],
      });

      insertConversation('search-nomatch', conv);

      const store = new KiroSessionStore(dbPath);
      const results = await store.searchSessions('zzzznonexistentterm', [
        'kiro-sqlite://search-nomatch',
      ]);
      expect(results).toHaveLength(0);
    });

    it('search handles empty query', async () => {
      insertConversation('store-test-1', sampleConversation);

      const store = new KiroSessionStore(dbPath);
      const results = await store.searchSessions('', ['kiro-sqlite://store-test-1']);
      expect(results).toHaveLength(0);
    });

    it('search includes snippets', async () => {
      const conv = JSON.stringify({
        conversation_id: 'search-snippets',
        history: [
          {
            user: {
              content: { Prompt: { prompt: 'Fix the authentication flow in the login page' } },
              timestamp: '2025-01-15T10:00:00Z',
            },
            assistant: {
              Response: {
                message_id: 'msg-001',
                content: 'I found the authentication issue in login.ts',
              },
            },
          },
        ],
      });

      insertConversation('search-snippets', conv);

      const store = new KiroSessionStore(dbPath);
      const results = await store.searchSessions('authentication login', [
        'kiro-sqlite://search-snippets',
      ]);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippets.length).toBeGreaterThan(0);
    });
  });

  // -- Write Session --

  describe('writeSession', () => {
    it('writes a session to SQLite', async () => {
      const store = new KiroSessionStore(dbPath);
      const turns: ConversationTurn[] = [
        {
          index: 0,
          lineNumber: 1,
          role: 'user',
          textPreview: 'Fix the bug',
          contentBlocks: [{ kind: { type: 'text' }, text: 'Fix the bug' }],
          timestamp: '2025-01-15T10:00:00Z',
        },
        {
          index: 1,
          lineNumber: 2,
          role: 'assistant',
          textPreview: 'I will fix it',
          contentBlocks: [{ kind: { type: 'text' }, text: 'I will fix it' }],
          timestamp: '2025-01-15T10:01:00Z',
        },
      ];

      const resultPath = await store.writeSession(
        turns,
        'new-session-id',
        '/Users/dev/project',
      );

      expect(resultPath).toBe('kiro-sqlite://new-session-id');

      // Verify in database
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare(
        'SELECT key, value FROM conversations_v2 WHERE conversation_id = ?',
      ).get('new-session-id') as { key: string; value: string };
      db.close();

      expect(row.key).toBe('/Users/dev/project');

      const parsed = JSON.parse(row.value);
      expect(parsed.conversation_id).toBe('new-session-id');
      expect(parsed.history).toHaveLength(1); // 2 turns -> 1 history entry
    });
  });
});
