import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { KiroSessionDiscovery } from '../session-discovery.js';

describe('KiroSessionDiscovery', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-kiro-discovery-'));
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
    key: string,
    conversationId: string,
    options?: {
      prompt?: string;
      createdAt?: string;
      updatedAt?: string;
    },
  ): void {
    const prompt = options?.prompt ?? `Hello from ${conversationId}`;
    const createdAt = options?.createdAt ?? '2025-01-15T10:00:00Z';
    const updatedAt = options?.updatedAt ?? '2025-01-15T10:05:00Z';

    const value = JSON.stringify({
      conversation_id: conversationId,
      history: [
        {
          user: {
            content: { Prompt: { prompt } },
            timestamp: createdAt,
            images: [],
          },
          assistant: {
            Response: { message_id: 'msg-001', content: 'Response text' },
          },
        },
      ],
    });

    const db = new Database(dbPath);
    db.prepare(
      'INSERT INTO conversations_v2 (key, conversation_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(key, conversationId, value, createdAt, updatedAt);
    db.close();
  }

  // -- Discovery --

  it('discovers sessions from SQLite database', async () => {
    insertConversation('/Users/dev/project-a', 'conv-001');
    insertConversation('/Users/dev/project-b', 'conv-002');

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions.every(s => s.assistant === 'kiro')).toBe(true);
  });

  it('sessions are sorted by updated_at descending', async () => {
    insertConversation('/Users/dev/project-a', 'old-conv', {
      updatedAt: '2025-01-15T08:00:00Z',
    });
    insertConversation('/Users/dev/project-b', 'new-conv', {
      updatedAt: '2025-01-15T12:00:00Z',
    });

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('new-conv');
    expect(sessions[1].id).toBe('old-conv');
  });

  it('maps projectPath from key column', async () => {
    insertConversation('/Users/dev/my-awesome-project', 'conv-path');

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectPath).toBe('/Users/dev/my-awesome-project');
  });

  it('gitBranch is always null', async () => {
    insertConversation('/Users/dev/project', 'conv-branch');

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions[0].gitBranch).toBeNull();
  });

  it('extracts firstPrompt from conversation value', async () => {
    insertConversation('/Users/dev/project', 'conv-prompt', {
      prompt: 'Fix the login validation bug',
    });

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions[0].firstPrompt).toBe('Fix the login validation bug');
  });

  it('extracts messageCount from conversation history', async () => {
    insertConversation('/Users/dev/project', 'conv-count');

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions[0].messageCount).toBe(1); // 1 history entry
  });

  it('jsonlPath uses kiro-sqlite:// scheme', async () => {
    insertConversation('/Users/dev/project', 'conv-jsonl');

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions[0].jsonlPath).toBe('kiro-sqlite://conv-jsonl');
  });

  it('returns empty for non-existent database', async () => {
    const discovery = new KiroSessionDiscovery('/nonexistent/data.sqlite3');
    const sessions = await discovery.discoverSessions();
    expect(sessions).toHaveLength(0);
  });

  it('returns empty for empty database', async () => {
    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();
    expect(sessions).toHaveLength(0);
  });

  it('handles empty key gracefully', async () => {
    insertConversation('', 'conv-no-key');

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectPath).toBeNull();
  });

  // -- Caching --

  it('uses mtime caching for unchanged database', async () => {
    insertConversation('/Users/dev/project', 'conv-cached');

    const discovery = new KiroSessionDiscovery(dbPath);

    const first = await discovery.discoverSessions();
    expect(first).toHaveLength(1);

    // Second call should use cache (database mtime unchanged)
    const second = await discovery.discoverSessions();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('conv-cached');
  });

  it('detects new sessions when database changes', async () => {
    insertConversation('/Users/dev/project', 'conv-1');

    const discovery = new KiroSessionDiscovery(dbPath);
    const first = await discovery.discoverSessions();
    expect(first).toHaveLength(1);

    // Add a new conversation (changes the DB file mtime)
    insertConversation('/Users/dev/project', 'conv-2');

    const second = await discovery.discoverSessions();
    expect(second).toHaveLength(2);
  });

  it('evicts removed sessions', async () => {
    insertConversation('/Users/dev/project', 'conv-to-remove');
    insertConversation('/Users/dev/project', 'conv-to-keep');

    const discovery = new KiroSessionDiscovery(dbPath);
    const first = await discovery.discoverSessions();
    expect(first).toHaveLength(2);

    // Remove one conversation
    const db = new Database(dbPath);
    db.prepare('DELETE FROM conversations_v2 WHERE conversation_id = ?').run('conv-to-remove');
    db.close();

    const second = await discovery.discoverSessions();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('conv-to-keep');
  });

  // -- discoverNewOrModified --

  it('discoverNewOrModified delegates to discoverSessions', async () => {
    insertConversation('/Users/dev/project', 'conv-modified');

    const discovery = new KiroSessionDiscovery(dbPath);
    const sessions = await discovery.discoverNewOrModified(new Date());
    expect(sessions).toHaveLength(1);
  });
});
