import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GeminiSessionStore } from '../session-store.js';
import type { ConversationTurn } from '@kanban-code/shared';

describe('GeminiSessionStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-gemini-store-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeTempSession(json: string): string {
    const filePath = path.join(tempDir, `session-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(filePath, json, 'utf-8');
    return filePath;
  }

  const sampleSession = JSON.stringify({
    sessionId: 'store-test-1',
    messages: [
      { type: 'user', content: [{ text: 'Fix the bug' }] },
      {
        type: 'gemini',
        content: "I'll fix it.",
        toolCalls: [
          {
            name: 'editFile',
            displayName: 'Edit File',
            args: { path: 'src/main.ts' },
            result: 'File edited successfully',
            status: 'completed',
          },
        ],
        thoughts: [{ text: 'Need to find the bug first' }],
      },
      { type: 'info', content: 'Checkpoint saved' },
      { type: 'user', content: [{ text: 'Now add tests' }] },
      { type: 'gemini', content: 'Adding tests now.' },
    ],
  });

  // -- Read Transcript --

  describe('readTranscript', () => {
    it('reads transcript from session file', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);
      expect(turns).toHaveLength(5);
    });

    it('maps message types to roles correctly', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);

      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
      expect(turns[2].role).toBe('system'); // info
      expect(turns[3].role).toBe('user');
      expect(turns[4].role).toBe('assistant');
    });

    it('extracts text content from user messages', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);

      expect(turns[0].textPreview).toBe('Fix the bug');
      expect(turns[3].textPreview).toBe('Now add tests');
    });

    it('includes tool calls in content blocks', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);

      const assistantTurn = turns[1];
      const toolBlocks = assistantTurn.contentBlocks.filter(
        b => b.kind.type === 'toolUse'
      );
      expect(toolBlocks).toHaveLength(1);
      const kind = toolBlocks[0].kind;
      if (kind.type === 'toolUse') {
        expect(kind.name).toBe('Edit File');
        expect(kind.input.path).toBe('src/main.ts');
      }
    });

    it('includes thinking blocks', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);

      const assistantTurn = turns[1];
      const thinkBlocks = assistantTurn.contentBlocks.filter(
        b => b.kind.type === 'thinking'
      );
      expect(thinkBlocks).toHaveLength(1);
      expect(thinkBlocks[0].text).toBe('Need to find the bug first');
    });

    it('turn indices are sequential', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);

      for (let i = 0; i < turns.length; i++) {
        expect(turns[i].index).toBe(i);
      }
    });

    it('line numbers are 1-based', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);

      expect(turns[0].lineNumber).toBe(1);
      expect(turns[1].lineNumber).toBe(2);
      expect(turns[2].lineNumber).toBe(3);
    });

    it('throws for non-existent file', async () => {
      const store = new GeminiSessionStore();
      await expect(
        store.readTranscript('/nonexistent/session.json')
      ).rejects.toThrow('File not found');
    });

    it('throws for unparseable file', async () => {
      const filePath = writeTempSession('not json');
      const store = new GeminiSessionStore();
      await expect(store.readTranscript(filePath)).rejects.toThrow();
    });
  });

  // -- Fork Session --

  describe('forkSession', () => {
    it('fork creates new file with new sessionId', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const newId = await store.forkSession(filePath);

      expect(newId).toBeTruthy();
      expect(newId).not.toBe('store-test-1');

      // Verify new file exists
      const files = fs.readdirSync(tempDir);
      const forkedFiles = files.filter(f => f.includes('forked') && f.includes(newId));
      expect(forkedFiles).toHaveLength(1);
    });

    it('forked session has replaced sessionId in content', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const newId = await store.forkSession(filePath);

      const newFileName = `session-forked-${newId}.json`;
      const newPath = path.join(tempDir, newFileName);
      const content = fs.readFileSync(newPath, 'utf-8');

      expect(content).toContain(newId);
      expect(content).not.toContain('store-test-1');
    });

    it('fork to custom directory', async () => {
      const filePath = writeTempSession(sampleSession);
      const targetDir = path.join(tempDir, 'fork-target');
      const store = new GeminiSessionStore();
      const newId = await store.forkSession(filePath, targetDir);

      const newPath = path.join(targetDir, `session-forked-${newId}.json`);
      expect(fs.existsSync(newPath)).toBe(true);
    });

    it('fork throws for non-existent file', async () => {
      const store = new GeminiSessionStore();
      await expect(
        store.forkSession('/nonexistent/session.json')
      ).rejects.toThrow('File not found');
    });

    it('fork preserves original mtime', async () => {
      const filePath = writeTempSession(sampleSession);
      const oldTime = new Date('2025-01-01T00:00:00Z');
      fs.utimesSync(filePath, oldTime, oldTime);

      const store = new GeminiSessionStore();
      const newId = await store.forkSession(filePath);

      const newPath = path.join(tempDir, `session-forked-${newId}.json`);
      const stat = fs.statSync(newPath);
      // mtime should match the original file's mtime
      expect(Math.abs(stat.mtimeMs - oldTime.getTime())).toBeLessThan(1000);
    });
  });

  // -- Truncate Session --

  describe('truncateSession', () => {
    it('truncate keeps only first N messages', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);

      // Truncate after turn at lineNumber 2 (keep messages 0 and 1)
      await store.truncateSession(filePath, turns[1]);

      const truncated = await store.readTranscript(filePath);
      expect(truncated).toHaveLength(2);
      expect(truncated[0].role).toBe('user');
      expect(truncated[1].role).toBe('assistant');
    });

    it('truncate creates backup file', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const turns = await store.readTranscript(filePath);
      await store.truncateSession(filePath, turns[0]);

      expect(fs.existsSync(filePath + '.bkp')).toBe(true);
    });

    it('truncate throws for non-existent file', async () => {
      const store = new GeminiSessionStore();
      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 1,
        role: 'user',
        textPreview: 'test',
        contentBlocks: [],
      };
      await expect(
        store.truncateSession('/nonexistent/session.json', turn)
      ).rejects.toThrow('File not found');
    });
  });

  // -- Search Sessions --

  describe('searchSessions', () => {
    it('search finds matching sessions', async () => {
      const session1 = JSON.stringify({
        sessionId: 'search-1',
        messages: [
          { type: 'user', content: [{ text: 'Fix the login validation bug' }] },
          { type: 'gemini', content: "I'll fix the validation." },
        ],
      });
      const session2 = JSON.stringify({
        sessionId: 'search-2',
        messages: [
          { type: 'user', content: [{ text: 'Add dark mode support' }] },
          { type: 'gemini', content: 'Adding dark mode.' },
        ],
      });

      const path1 = writeTempSession(session1);
      const path2 = writeTempSession(session2);

      const store = new GeminiSessionStore();
      const results = await store.searchSessions('login validation', [path1, path2]);

      expect(results.length).toBeGreaterThan(0);
      // The login session should rank higher
      expect(results[0].sessionPath).toBe(path1);
    });

    it('search returns empty for no matches', async () => {
      const session = JSON.stringify({
        sessionId: 'search-nomatch',
        messages: [
          { type: 'user', content: [{ text: 'Hello world' }] },
          { type: 'gemini', content: 'Hi' },
        ],
      });
      const filePath = writeTempSession(session);

      const store = new GeminiSessionStore();
      const results = await store.searchSessions('zzzznonexistentterm', [filePath]);
      expect(results).toHaveLength(0);
    });

    it('search handles empty query', async () => {
      const filePath = writeTempSession(sampleSession);
      const store = new GeminiSessionStore();
      const results = await store.searchSessions('', [filePath]);
      expect(results).toHaveLength(0);
    });
  });

  // -- Write Session --

  describe('writeSession', () => {
    it('writes a session file with proper structure', async () => {
      const store = new GeminiSessionStore();
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

      const geminiDir = path.join(tempDir, '.gemini');
      const slugDir = path.join(geminiDir, 'tmp', 'test-project', 'chats');
      fs.mkdirSync(slugDir, { recursive: true });

      // Create a projects.json to map path -> slug
      const projectsJson = { projects: { '/Users/dev/test-project': 'test-project' } };
      fs.writeFileSync(
        path.join(geminiDir, 'projects.json'),
        JSON.stringify(projectsJson),
        'utf-8'
      );

      const filePath = await store.writeSession(
        turns,
        'new-session-id',
        '/Users/dev/test-project',
        geminiDir
      );

      expect(fs.existsSync(filePath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(written.sessionId).toBe('new-session-id');
      expect(written.messages).toHaveLength(2);
    });
  });
});
