import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GeminiSessionParser, type MessageContent } from '../session-parser.js';

describe('GeminiSessionParser', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-gemini-parser-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeTempFile(content: string): string {
    const filePath = path.join(tempDir, `session-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  // -- Sample data --

  const minimalSession = JSON.stringify({
    sessionId: 'abc-123-def',
    messages: [
      { type: 'user', content: [{ text: 'Hello, fix the login bug' }] },
      { type: 'gemini', content: "I'll help you fix the login bug." },
    ],
  });

  const sessionWithToolCalls = JSON.stringify({
    sessionId: 'tool-session-1',
    projectHash: 'proj-hash',
    startTime: '2025-01-15T10:00:00Z',
    lastUpdated: '2025-01-15T10:05:00Z',
    summary: 'Fixed login validation',
    messages: [
      { type: 'user', content: [{ text: 'Fix the login validation' }] },
      {
        type: 'gemini',
        content: 'Let me look at the code.',
        toolCalls: [
          {
            id: 'tc1',
            name: 'readFile',
            displayName: 'Read File',
            args: { path: 'src/login.ts' },
            result: 'function login() {\n  // validation here\n}',
            status: 'completed',
          },
        ],
        thoughts: [{ text: 'I need to check the login file first.' }],
      },
      { type: 'info', content: 'File saved successfully' },
      { type: 'error', content: 'Warning: deprecated API' },
    ],
  });

  const sessionWithParts = JSON.stringify({
    sessionId: 'parts-session',
    messages: [
      { type: 'user', content: [{ text: 'First part' }, { text: 'Second part' }] },
      { type: 'gemini', content: 'Got both parts.' },
    ],
  });

  const emptyMessagesSession = JSON.stringify({
    sessionId: 'empty-session',
    messages: [],
  });

  const infoOnlySession = JSON.stringify({
    sessionId: 'info-only',
    messages: [{ type: 'info', content: 'Session started' }],
  });

  // -- Metadata Extraction --

  describe('extractMetadata', () => {
    it('extracts metadata from minimal session', () => {
      const filePath = writeTempFile(minimalSession);
      const metadata = GeminiSessionParser.extractMetadata(filePath);

      expect(metadata).not.toBeNull();
      expect(metadata!.sessionId).toBe('abc-123-def');
      expect(metadata!.messageCount).toBe(2);
      expect(metadata!.firstPrompt).toBe('Hello, fix the login bug');
      expect(metadata!.summary).toBeNull();
    });

    it('extracts metadata with summary', () => {
      const filePath = writeTempFile(sessionWithToolCalls);
      const metadata = GeminiSessionParser.extractMetadata(filePath);

      expect(metadata).not.toBeNull();
      expect(metadata!.sessionId).toBe('tool-session-1');
      expect(metadata!.summary).toBe('Fixed login validation');
      expect(metadata!.firstPrompt).toBe('Fix the login validation');
      // Only user + gemini messages count (not info/error)
      expect(metadata!.messageCount).toBe(2);
    });

    it('returns null for empty messages', () => {
      const filePath = writeTempFile(emptyMessagesSession);
      const metadata = GeminiSessionParser.extractMetadata(filePath);
      expect(metadata).toBeNull();
    });

    it('returns null for info-only session', () => {
      const filePath = writeTempFile(infoOnlySession);
      const metadata = GeminiSessionParser.extractMetadata(filePath);
      expect(metadata).toBeNull();
    });

    it('joins multi-part user content', () => {
      const filePath = writeTempFile(sessionWithParts);
      const metadata = GeminiSessionParser.extractMetadata(filePath);
      expect(metadata!.firstPrompt).toBe('First part\nSecond part');
    });

    it('truncates long first prompt to 500 chars', () => {
      const longText = 'a'.repeat(1000);
      const json = JSON.stringify({
        sessionId: 'long-prompt',
        messages: [
          { type: 'user', content: [{ text: longText }] },
          { type: 'gemini', content: 'ok' },
        ],
      });
      const filePath = writeTempFile(json);
      const metadata = GeminiSessionParser.extractMetadata(filePath);
      expect(metadata!.firstPrompt!.length).toBe(500);
    });

    it('throws for non-existent file', () => {
      expect(() => {
        GeminiSessionParser.extractMetadata('/nonexistent/path/session.json');
      }).toThrow();
    });

    it('throws for invalid JSON', () => {
      const filePath = writeTempFile('not json at all');
      expect(() => {
        GeminiSessionParser.extractMetadata(filePath);
      }).toThrow();
    });
  });

  // -- Full Parsing --

  describe('parseSession', () => {
    it('parses full session file', () => {
      const filePath = writeTempFile(minimalSession);
      const session = GeminiSessionParser.parseSession(filePath);

      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('abc-123-def');
      expect(session!.messages).toHaveLength(2);
    });

    it('parses session with all fields', () => {
      const filePath = writeTempFile(sessionWithToolCalls);
      const session = GeminiSessionParser.parseSession(filePath);

      expect(session).not.toBeNull();
      expect(session!.projectHash).toBe('proj-hash');
      expect(session!.startTime).toBe('2025-01-15T10:00:00Z');
      expect(session!.summary).toBe('Fixed login validation');
      expect(session!.messages).toHaveLength(4);

      const geminiMsg = session!.messages[1];
      expect(geminiMsg.toolCalls).toHaveLength(1);
      expect(geminiMsg.toolCalls![0].name).toBe('readFile');
      expect(geminiMsg.toolCalls![0].args!.path).toBe('src/login.ts');
      expect(geminiMsg.thoughts![0].text).toBe('I need to check the login file first.');
    });
  });

  // -- MessageContent --

  describe('MessageContent', () => {
    it('text variant', () => {
      const content: MessageContent = { type: 'text', value: 'Hello world' };
      expect(GeminiSessionParser.getTextValue(content)).toBe('Hello world');
    });

    it('parts variant', () => {
      const content: MessageContent = {
        type: 'parts',
        value: [{ text: 'part1' }, { text: 'part2' }],
      };
      expect(GeminiSessionParser.getTextValue(content)).toBe('part1\npart2');
    });

    it('empty fallback', () => {
      const content: MessageContent = { type: 'text', value: '' };
      expect(GeminiSessionParser.getTextValue(content)).toBe('');
    });
  });

  // -- Resilient Parsing --

  describe('resilient message parsing', () => {
    it('handles messages with unexpected structure', () => {
      const json = JSON.stringify({
        sessionId: 'resilient-test',
        messages: [
          { type: 'user', content: [{ text: 'Normal message' }] },
          { type: 'unknown-type', content: 42 }, // unusual content
          { type: 'gemini', content: 'Normal response' },
        ],
      });
      const filePath = writeTempFile(json);
      const session = GeminiSessionParser.parseSession(filePath);

      expect(session).not.toBeNull();
      // Should parse what it can, handling the weird message gracefully
      expect(session!.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('handles tool calls with functionResponse result arrays', () => {
      const json = JSON.stringify({
        sessionId: 'func-response-test',
        messages: [
          { type: 'user', content: [{ text: 'test' }] },
          {
            type: 'gemini',
            content: 'result',
            toolCalls: [
              {
                name: 'readFile',
                result: [
                  {
                    functionResponse: {
                      response: { output: 'file contents here' },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
      const filePath = writeTempFile(json);
      const session = GeminiSessionParser.parseSession(filePath);

      expect(session).not.toBeNull();
      const toolCall = session!.messages[1].toolCalls![0];
      expect(toolCall.result).toBe('file contents here');
    });
  });
});
