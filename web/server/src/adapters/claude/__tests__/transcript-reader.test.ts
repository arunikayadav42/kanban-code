import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptReader } from '../transcript-reader.js';
import type { ContentBlock, ConversationTurn } from '@kanban-code/shared';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-code-transcript-test-'));
}

function writeJsonl(dir: string, name: string, lines: string[]): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

describe('TranscriptReader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readTurns (via readTail)', () => {
    it('reads user and assistant turns', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Hello"},"cwd":"/test","timestamp":"2026-01-01T00:00:00Z"}',
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Hi there! How can I help?"}]}}',
        '{"type":"user","sessionId":"s1","message":{"content":"Fix the bug"},"cwd":"/test"}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns).toHaveLength(3);
      expect(turns[0].role).toBe('user');
      expect(turns[0].textPreview).toBe('Hello');
      expect(turns[0].timestamp).toBe('2026-01-01T00:00:00Z');
      expect(turns[1].role).toBe('assistant');
      expect(turns[1].textPreview).toBe('Hi there! How can I help?');
      expect(turns[2].role).toBe('user');
      expect(turns[2].textPreview).toBe('Fix the bug');
    });

    it('skips non-message lines', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"file-history-snapshot","data":"lots of data"}',
        '{"type":"user","sessionId":"s1","message":{"content":"Hello"},"cwd":"/test"}',
        '{"type":"progress","data":"loading"}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns).toHaveLength(1);
      expect(turns[0].textPreview).toBe('Hello');
    });

    it('returns empty for nonexistent file', async () => {
      const turns = await TranscriptReader.readTurns('/nonexistent/path.jsonl');
      expect(turns).toHaveLength(0);
    });

    it('handles tool-use-only assistant responses', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns).toHaveLength(1);
      expect(turns[0].textPreview).toBe('[tool: Read]');
    });

    it('line numbers are correct', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"file-history-snapshot","data":"stuff"}',
        '{"type":"user","sessionId":"s1","message":{"content":"Hello"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Hi"}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns[0].lineNumber).toBe(2); // first message line is line 2
      expect(turns[1].lineNumber).toBe(3);
    });
  });

  describe('rich content block tests', () => {
    it('parses Bash tool_use blocks', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls -la","description":"List files"}}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns).toHaveLength(1);
      expect(turns[0].contentBlocks).toHaveLength(1);
      const block = turns[0].contentBlocks[0];
      expect(block.kind).toEqual({ type: 'toolUse', name: 'Bash', input: { command: 'ls -la', description: 'List files' } });
      expect(block.text).toBe('Bash(List files)');
    });

    it('parses Read tool_use blocks', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/Users/test/src/main.swift"}}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      const block = turns[0].contentBlocks[0];
      expect(block.kind).toEqual({ type: 'toolUse', name: 'Read', input: { file_path: '/Users/test/src/main.swift' } });
      expect(block.text).toContain('main.swift');
    });

    it('parses Edit tool_use blocks', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/app.swift","old_string":"foo","new_string":"bar"}}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      const block = turns[0].contentBlocks[0];
      expect((block.kind as { type: 'toolUse'; name: string }).name).toBe('Edit');
      expect(block.text).toContain('app.swift');
    });

    it('parses multiple content blocks in one message', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Let me read the file."},{"type":"tool_use","name":"Read","input":{"file_path":"/test.swift"}}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns[0].contentBlocks).toHaveLength(2);
      expect(turns[0].contentBlocks[0].kind).toEqual({ type: 'text' });
      expect(turns[0].contentBlocks[0].text).toBe('Let me read the file.');
      expect((turns[0].contentBlocks[1].kind as { type: 'toolUse'; name: string }).name).toBe('Read');
    });

    it('parses tool_result blocks in user messages', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_123","content":"file contents here\\nline 2\\nline 3"}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns).toHaveLength(1);
      expect(turns[0].contentBlocks).toHaveLength(1);
      expect(turns[0].contentBlocks[0].kind).toEqual({ type: 'toolResult', toolName: null });
      expect(turns[0].contentBlocks[0].text).toBe('Result (3 lines)');
    });

    it('mixed text and tool_use - textPreview only from text blocks', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"I will fix this."},{"type":"tool_use","name":"Edit","input":{"file_path":"/test.swift"}}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns[0].textPreview).toBe('I will fix this.');
      // textPreview should NOT contain "Edit" tool name
      expect(turns[0].textPreview).not.toContain('Edit');
    });

    it('parses thinking blocks', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"thinking","thinking":"Let me analyze this..."},{"type":"text","text":"Here is my answer."}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns[0].contentBlocks).toHaveLength(2);
      expect(turns[0].contentBlocks[0].kind).toEqual({ type: 'thinking' });
      expect(turns[0].contentBlocks[0].text).toBe('Let me analyze this...');
      expect(turns[0].textPreview).toBe('Here is my answer.');
    });

    it('Grep tool input extraction', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"TODO","path":"/Users/test/src/"}}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      const block = turns[0].contentBlocks[0];
      const kind = block.kind as { type: 'toolUse'; name: string; input: Record<string, string> };
      expect(kind.name).toBe('Grep');
      expect(kind.input.pattern).toBe('TODO');
      expect(kind.input.path).toBe('/Users/test/src/');
      expect(block.text).toContain('"TODO"');
    });
  });

  describe('backward compatibility', () => {
    it('contentBlocks defaults to empty', () => {
      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 1,
        role: 'user',
        textPreview: 'hello',
        contentBlocks: [],
      };
      expect(turn.contentBlocks).toHaveLength(0);
    });
  });

  describe('shortenPath', () => {
    it('shortens long paths', () => {
      const short = TranscriptReader.shortenPath('/Users/test/Projects/remote/kanban/Sources/Kanban/App.swift');
      expect(short).toBe('.../Sources/Kanban/App.swift');
    });

    it('keeps short paths unchanged', () => {
      const alreadyShort = TranscriptReader.shortenPath('/src/main.swift');
      expect(alreadyShort).toBe('/src/main.swift');
    });
  });

  describe('metadata filtering in history', () => {
    it('hides caveat messages from history', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"user","isMeta":true,"sessionId":"s1","message":{"content":"<local-command-caveat>wrapped</local-command-caveat>"},"cwd":"/test"}',
        '{"type":"user","sessionId":"s1","message":{"content":"Real prompt"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"OK"}]}}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      // Caveat message should be completely hidden -- only 2 turns
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[0].textPreview).toBe('Real prompt');
      expect(turns[1].role).toBe('assistant');
    });

    it('shows /clear command cleanly in history', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"<command-name>/clear</command-name><command-message></command-message><command-args></command-args>"},"cwd":"/test"}',
        '{"type":"user","sessionId":"s1","message":{"content":"Next prompt"},"cwd":"/test"}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns).toHaveLength(2);
      expect(turns[0].textPreview).toBe('/clear');
      expect(turns[1].textPreview).toBe('Next prompt');
    });

    it('shows command stdout as assistant-style turn in history', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"<local-command-stdout>file contents here</local-command-stdout>"},"cwd":"/test"}',
      ]);

      const turns = await TranscriptReader.readTurns(filePath);
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe('assistant');
      expect(turns[0].textPreview).toBe('file contents here');
    });
  });

  describe('readTail pagination', () => {
    it('returns last N turns when maxTurns is limited', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(`{"type":"user","sessionId":"s1","message":{"content":"Message ${i}"},"cwd":"/test"}`);
      }
      const filePath = writeJsonl(tempDir, 'test.jsonl', lines);

      const result = await TranscriptReader.readTail(filePath, 3);
      expect(result.turns).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      expect(result.totalLineCount).toBe(10);
      expect(result.turns[0].textPreview).toBe('Message 7');
      expect(result.turns[1].textPreview).toBe('Message 8');
      expect(result.turns[2].textPreview).toBe('Message 9');
    });

    it('returns all turns when maxTurns exceeds count', async () => {
      const filePath = writeJsonl(tempDir, 'test.jsonl', [
        '{"type":"user","sessionId":"s1","message":{"content":"Hello"},"cwd":"/test"}',
        '{"type":"assistant","sessionId":"s1","message":{"content":[{"type":"text","text":"Hi"}]}}',
      ]);

      const result = await TranscriptReader.readTail(filePath, 100);
      expect(result.turns).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it('turn indices are correct with readTail', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(`{"type":"user","sessionId":"s1","message":{"content":"Message ${i}"},"cwd":"/test"}`);
      }
      const filePath = writeJsonl(tempDir, 'test.jsonl', lines);

      const result = await TranscriptReader.readTail(filePath, 3);
      // Turns 7, 8, 9 should have indices 7, 8, 9
      expect(result.turns[0].index).toBe(7);
      expect(result.turns[1].index).toBe(8);
      expect(result.turns[2].index).toBe(9);
    });
  });

  describe('readRange', () => {
    it('reads specified turn range', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(`{"type":"user","sessionId":"s1","message":{"content":"Message ${i}"},"cwd":"/test"}`);
      }
      const filePath = writeJsonl(tempDir, 'test.jsonl', lines);

      const turns = await TranscriptReader.readRange(filePath, 2, 5);
      expect(turns).toHaveLength(3);
      expect(turns[0].textPreview).toBe('Message 2');
      expect(turns[0].index).toBe(2);
      expect(turns[1].textPreview).toBe('Message 3');
      expect(turns[2].textPreview).toBe('Message 4');
    });

    it('returns empty for nonexistent file', async () => {
      const turns = await TranscriptReader.readRange('/nonexistent/path.jsonl', 0, 5);
      expect(turns).toHaveLength(0);
    });

    it('stops at upper bound', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 20; i++) {
        lines.push(`{"type":"user","sessionId":"s1","message":{"content":"Message ${i}"},"cwd":"/test"}`);
      }
      const filePath = writeJsonl(tempDir, 'test.jsonl', lines);

      const turns = await TranscriptReader.readRange(filePath, 18, 25);
      expect(turns).toHaveLength(2);
      expect(turns[0].textPreview).toBe('Message 18');
      expect(turns[1].textPreview).toBe('Message 19');
    });
  });

  describe('buildTextPreview', () => {
    it('returns text from text blocks', () => {
      const blocks: ContentBlock[] = [
        { kind: { type: 'text' }, text: 'Hello world' },
      ];
      expect(TranscriptReader.buildTextPreview(blocks, 'user')).toBe('Hello world');
    });

    it('returns (empty) for empty blocks', () => {
      expect(TranscriptReader.buildTextPreview([], 'user')).toBe('(empty)');
    });

    it('returns tool result count for user messages', () => {
      const blocks: ContentBlock[] = [
        { kind: { type: 'toolResult', toolName: null }, text: 'result1' },
        { kind: { type: 'toolResult', toolName: null }, text: 'result2' },
      ];
      expect(TranscriptReader.buildTextPreview(blocks, 'user')).toBe('[tool result x2]');
    });

    it('returns tool names for assistant messages', () => {
      const blocks: ContentBlock[] = [
        { kind: { type: 'toolUse', name: 'Read', input: {} }, text: 'Read(/test.swift)' },
        { kind: { type: 'toolUse', name: 'Edit', input: {} }, text: 'Edit(/test.swift)' },
      ];
      expect(TranscriptReader.buildTextPreview(blocks, 'assistant')).toBe('[tool: Read, Edit]');
    });

    it('deduplicates tool names', () => {
      const blocks: ContentBlock[] = [
        { kind: { type: 'toolUse', name: 'Read', input: {} }, text: 'Read(/a.swift)' },
        { kind: { type: 'toolUse', name: 'Read', input: {} }, text: 'Read(/b.swift)' },
      ];
      expect(TranscriptReader.buildTextPreview(blocks, 'assistant')).toBe('[tool: Read]');
    });

    it('truncates text to 500 chars', () => {
      const longText = 'a'.repeat(600);
      const blocks: ContentBlock[] = [
        { kind: { type: 'text' }, text: longText },
      ];
      const preview = TranscriptReader.buildTextPreview(blocks, 'user');
      expect(preview.length).toBe(500);
    });
  });
});
