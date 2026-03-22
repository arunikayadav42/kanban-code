import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeCodeSessionStore, SessionStoreError } from '../session-store.js';
import type { ConversationTurn, ContentBlock } from '@kanban-code/shared';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-code-ops-test-'));
}

function writeJsonl(dir: string, name: string, lines: string[]): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

describe('ClaudeCodeSessionStore', () => {
  let store: ClaudeCodeSessionStore;
  let tempDir: string;

  beforeEach(() => {
    store = new ClaudeCodeSessionStore();
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readTranscript', () => {
    it('delegates to TranscriptReader', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Hello"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Hi"}]}}',
      ]);

      const turns = await store.readTranscript(filePath);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
    });
  });

  describe('forkSession', () => {
    it('creates new file with new session ID', async () => {
      const filePath = writeJsonl(tempDir, 'original-id.jsonl', [
        '{"type":"user","sessionId":"original-id","message":{"content":"Hello"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"original-id","message":{"content":[{"type":"text","text":"Hi"}]}}',
      ]);

      const newId = await store.forkSession(filePath);
      expect(newId).toBeTruthy();
      expect(newId).not.toBe('original-id');

      // Check new file exists
      const newPath = path.join(tempDir, `${newId}.jsonl`);
      expect(fs.existsSync(newPath)).toBe(true);

      // Check session IDs were replaced
      const content = fs.readFileSync(newPath, 'utf-8');
      expect(content).toContain(newId);
      expect(content).not.toContain('original-id');
    });

    it('throws for nonexistent file', async () => {
      await expect(store.forkSession('/nonexistent.jsonl')).rejects.toThrow(SessionStoreError);
    });

    it('preserves original mtime on the fork', async () => {
      const filePath = writeJsonl(tempDir, 'mtime-test.jsonl', [
        '{"type":"user","sessionId":"mtime-test","message":{"content":"Hello"},"cwd":"/test"}',
      ]);

      // Set a specific old mtime
      const oldTime = new Date('2025-01-01T00:00:00Z');
      fs.utimesSync(filePath, oldTime, oldTime);

      const newId = await store.forkSession(filePath);
      const newPath = path.join(tempDir, `${newId}.jsonl`);

      const newStat = fs.statSync(newPath);
      // Mtime should be near the old time (within 1 second)
      expect(Math.abs(newStat.mtimeMs - oldTime.getTime())).toBeLessThan(1000);
    });

    it('forks to a specified target directory', async () => {
      const filePath = writeJsonl(tempDir, 'original.jsonl', [
        '{"type":"user","sessionId":"original","message":{"content":"Hello"},"cwd":"/test"}',
      ]);

      const targetDir = path.join(tempDir, 'target-subdir');
      const newId = await store.forkSession(filePath, targetDir);

      const newPath = path.join(targetDir, `${newId}.jsonl`);
      expect(fs.existsSync(newPath)).toBe(true);
    });
  });

  describe('truncateSession', () => {
    it('truncates after given turn', async () => {
      const filePath = writeJsonl(tempDir, 'sess.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"First"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Reply 1"}]}}',
        '{"type":"user","sessionId":"s1","message":{"content":"Second"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Reply 2"}]}}',
      ]);

      const turn: ConversationTurn = {
        index: 1,
        lineNumber: 2,
        role: 'assistant',
        textPreview: 'Reply 1',
        contentBlocks: [],
      };
      await store.truncateSession(filePath, turn);

      // Check backup was created
      expect(fs.existsSync(filePath + '.bkp')).toBe(true);

      // Check truncated file has only 2 lines
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(content).toContain('First');
      expect(content).toContain('Reply 1');
      expect(content).not.toContain('Second');
    });

    it('backup preserves original', async () => {
      const filePath = writeJsonl(tempDir, 'sess.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Line 1"},"cwd":"/test"}',
        '{"type":"user","sessionId":"s1","message":{"content":"Line 2"},"cwd":"/test"}',
      ]);

      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 1,
        role: 'user',
        textPreview: 'Line 1',
        contentBlocks: [],
      };
      await store.truncateSession(filePath, turn);

      const backup = fs.readFileSync(filePath + '.bkp', 'utf-8');
      expect(backup).toContain('Line 1');
      expect(backup).toContain('Line 2');
    });

    it('throws for nonexistent file', async () => {
      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 1,
        role: 'user',
        textPreview: 'test',
        contentBlocks: [],
      };
      await expect(
        store.truncateSession('/nonexistent.jsonl', turn)
      ).rejects.toThrow(SessionStoreError);
    });
  });

  describe('writeSession', () => {
    it('writes JSONL with correct structure', async () => {
      const turns: ConversationTurn[] = [
        {
          index: 0,
          lineNumber: 1,
          role: 'user',
          textPreview: 'Hello',
          timestamp: '2026-01-01T00:00:00Z',
          contentBlocks: [{ kind: { type: 'text' }, text: 'Hello' }],
        },
        {
          index: 1,
          lineNumber: 2,
          role: 'assistant',
          textPreview: 'Hi there',
          timestamp: '2026-01-01T00:00:01Z',
          contentBlocks: [{ kind: { type: 'text' }, text: 'Hi there' }],
        },
      ];

      const resultPath = await store.writeSession(turns, 'test-session', tempDir);
      expect(fs.existsSync(resultPath)).toBe(true);

      const content = fs.readFileSync(resultPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(2);

      // Parse lines and check structure
      const firstLine = JSON.parse(lines[0]);
      expect(firstLine.type).toBe('user');
      expect(firstLine.sessionId).toBe('test-session');
      expect(firstLine.message.content).toBe('Hello');

      const secondLine = JSON.parse(lines[1]);
      expect(secondLine.type).toBe('assistant');
      expect(secondLine.message.content).toBeInstanceOf(Array);
    });

    it('maps tool names correctly', async () => {
      const turns: ConversationTurn[] = [
        {
          index: 0,
          lineNumber: 1,
          role: 'assistant',
          textPreview: 'Running command',
          contentBlocks: [
            { kind: { type: 'toolUse', name: 'shell', input: { command: 'ls' } }, text: 'shell(ls)' },
          ],
        },
      ];

      const resultPath = await store.writeSession(turns, 'tool-test', tempDir);
      const content = fs.readFileSync(resultPath, 'utf-8');
      // "shell" should be mapped to "Bash"
      expect(content).toContain('"Bash"');
    });

    it('writes tool_result lines for tool_use blocks', async () => {
      const turns: ConversationTurn[] = [
        {
          index: 0,
          lineNumber: 1,
          role: 'assistant',
          textPreview: 'Reading file',
          contentBlocks: [
            { kind: { type: 'toolUse', name: 'Read', input: { file_path: '/test.ts' } }, text: 'Read(/test.ts) -> file content here' },
          ],
        },
      ];

      const resultPath = await store.writeSession(turns, 'result-test', tempDir);
      const content = fs.readFileSync(resultPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.length > 0);

      // Should have 2 lines: assistant message + tool_result
      expect(lines.length).toBe(2);
      const resultLine = JSON.parse(lines[1]);
      expect(resultLine.type).toBe('user');
      expect(resultLine.message.content[0].type).toBe('tool_result');
      expect(resultLine.message.content[0].content).toBe('file content here');
    });
  });

  describe('searchSessions', () => {
    it('finds matching sessions', async () => {
      const path1 = writeJsonl(tempDir, 's1.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Fix the authentication bug in login"},"cwd":"/test"}',
      ]);

      const path2 = writeJsonl(tempDir, 's2.jsonl', [
        '{"type":"user","sessionId":"s2","message":{"content":"Add new dashboard feature"},"cwd":"/test"}',
      ]);

      const results = await store.searchSessions('authentication login', [path1, path2]);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].sessionPath).toBe(path1); // auth/login session should rank first
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('returns empty for no matches', async () => {
      const filePath = writeJsonl(tempDir, 's1.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Hello world"},"cwd":"/test"}',
      ]);

      const results = await store.searchSessions('zzzznotfound', [filePath]);
      expect(results).toHaveLength(0);
    });

    it('returns empty for empty query terms', async () => {
      const filePath = writeJsonl(tempDir, 's1.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Hello"},"cwd":"/test"}',
      ]);

      const results = await store.searchSessions('a', [filePath]); // single char filtered out
      expect(results).toHaveLength(0);
    });

    it('handles nonexistent paths gracefully', async () => {
      const results = await store.searchSessions('test', ['/nonexistent/path.jsonl']);
      expect(results).toHaveLength(0);
    });

    it('includes snippets in results', async () => {
      const filePath = writeJsonl(tempDir, 's1.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"The authentication module has a critical bug in the login flow"},"cwd":"/test"}',
      ]);

      const results = await store.searchSessions('authentication', [filePath]);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippets.length).toBeGreaterThan(0);
    });
  });

  describe('searchSessionsStreaming', () => {
    it('calls onResult callback with accumulated results', async () => {
      const path1 = writeJsonl(tempDir, 's1.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Fix authentication bug"},"cwd":"/test"}',
      ]);

      const path2 = writeJsonl(tempDir, 's2.jsonl', [
        '{"type":"user","sessionId":"s2","message":{"content":"Authentication is broken"},"cwd":"/test"}',
      ]);

      const resultSnapshots: number[] = [];
      await store.searchSessionsStreaming(
        'authentication',
        [path1, path2],
        (results) => {
          resultSnapshots.push(results.length);
        },
      );

      // Should have been called at least once with results
      expect(resultSnapshots.length).toBeGreaterThan(0);
    });
  });

  describe('tool name mapping', () => {
    it('maps shell to Bash', () => {
      expect(ClaudeCodeSessionStore.mapToolName('shell')).toBe('Bash');
    });

    it('maps run_shell_command to Bash', () => {
      expect(ClaudeCodeSessionStore.mapToolName('run_shell_command')).toBe('Bash');
    });

    it('maps readfile to Read', () => {
      expect(ClaudeCodeSessionStore.mapToolName('readfile')).toBe('Read');
    });

    it('maps read_file to Read', () => {
      expect(ClaudeCodeSessionStore.mapToolName('read_file')).toBe('Read');
    });

    it('maps writefile to Write', () => {
      expect(ClaudeCodeSessionStore.mapToolName('writefile')).toBe('Write');
    });

    it('maps write_file to Write', () => {
      expect(ClaudeCodeSessionStore.mapToolName('write_file')).toBe('Write');
    });

    it('maps editfile to Edit', () => {
      expect(ClaudeCodeSessionStore.mapToolName('editfile')).toBe('Edit');
    });

    it('maps edit_file to Edit', () => {
      expect(ClaudeCodeSessionStore.mapToolName('edit_file')).toBe('Edit');
    });

    it('maps listfiles to Glob', () => {
      expect(ClaudeCodeSessionStore.mapToolName('listfiles')).toBe('Glob');
    });

    it('maps list_files to Glob', () => {
      expect(ClaudeCodeSessionStore.mapToolName('list_files')).toBe('Glob');
    });

    it('maps search to Grep', () => {
      expect(ClaudeCodeSessionStore.mapToolName('search')).toBe('Grep');
    });

    it('maps searchfiles to Grep', () => {
      expect(ClaudeCodeSessionStore.mapToolName('searchfiles')).toBe('Grep');
    });

    it('keeps unknown names as-is', () => {
      expect(ClaudeCodeSessionStore.mapToolName('CustomTool')).toBe('CustomTool');
    });
  });
});
