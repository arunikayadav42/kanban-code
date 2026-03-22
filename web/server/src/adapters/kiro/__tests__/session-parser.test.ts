import { describe, it, expect } from 'vitest';
import { KiroSessionParser } from '../session-parser.js';

describe('KiroSessionParser', () => {
  // -- Sample data --

  const minimalConversation = JSON.stringify({
    conversation_id: 'conv-abc-123',
    history: [
      {
        user: {
          content: { Prompt: { prompt: 'Fix the login bug' } },
          timestamp: '2025-01-15T10:00:00Z',
          images: [],
        },
        assistant: {
          Response: {
            message_id: 'msg-001',
            content: "I'll fix the login bug for you.",
          },
        },
        request_metadata: { model_id: 'claude-sonnet-4-20250514' },
      },
    ],
  });

  const multiTurnConversation = JSON.stringify({
    conversation_id: 'conv-multi-001',
    history: [
      {
        user: {
          content: { Prompt: { prompt: 'Add dark mode support' } },
          timestamp: '2025-01-15T10:00:00Z',
          images: [],
        },
        assistant: {
          Response: { message_id: 'msg-001', content: 'Let me look at the code.' },
        },
        request_metadata: { model_id: 'claude-sonnet-4-20250514' },
      },
      {
        user: {
          content: { Prompt: { prompt: 'Also add a toggle button' } },
          timestamp: '2025-01-15T10:01:00Z',
          images: [],
        },
        assistant: {
          ToolUse: {
            tool_use_id: 'tu-001',
            name: 'editFile',
            input: { path: 'src/theme.ts' },
          },
        },
      },
    ],
  });

  const toolResultConversation = JSON.stringify({
    conversation_id: 'conv-toolresult-001',
    history: [
      {
        user: {
          content: {
            ToolUseResults: {
              results: [
                { tool_use_id: 'tu-001', content: 'File edited successfully', is_error: false },
              ],
            },
          },
          timestamp: '2025-01-15T10:02:00Z',
          images: [],
        },
        assistant: {
          Response: { message_id: 'msg-002', content: 'The file has been updated.' },
        },
      },
    ],
  });

  const emptyConversation = JSON.stringify({
    conversation_id: 'conv-empty',
    history: [],
  });

  // -- parseConversation --

  describe('parseConversation', () => {
    it('parses minimal conversation', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation);

      expect(conv).not.toBeNull();
      expect(conv!.conversation_id).toBe('conv-abc-123');
      expect(conv!.history).toHaveLength(1);
    });

    it('parses multi-turn conversation', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation);

      expect(conv).not.toBeNull();
      expect(conv!.history).toHaveLength(2);
    });

    it('parses user Prompt content', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation);
      const userContent = conv!.history[0].user.content;

      expect('Prompt' in userContent).toBe(true);
      if ('Prompt' in userContent) {
        expect(userContent.Prompt.prompt).toBe('Fix the login bug');
      }
    });

    it('parses assistant Response content', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation);
      const assistantMsg = conv!.history[0].assistant;

      expect('Response' in assistantMsg).toBe(true);
      if ('Response' in assistantMsg) {
        expect(assistantMsg.Response.content).toBe("I'll fix the login bug for you.");
        expect(assistantMsg.Response.message_id).toBe('msg-001');
      }
    });

    it('parses assistant ToolUse content', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation);
      const assistantMsg = conv!.history[1].assistant;

      expect('ToolUse' in assistantMsg).toBe(true);
      if ('ToolUse' in assistantMsg) {
        expect(assistantMsg.ToolUse.name).toBe('editFile');
        expect(assistantMsg.ToolUse.input.path).toBe('src/theme.ts');
      }
    });

    it('parses ToolUseResults content', () => {
      const conv = KiroSessionParser.parseConversation(toolResultConversation);
      const userContent = conv!.history[0].user.content;

      expect('ToolUseResults' in userContent).toBe(true);
      if ('ToolUseResults' in userContent) {
        expect(userContent.ToolUseResults.results).toHaveLength(1);
        expect(userContent.ToolUseResults.results[0].content).toBe('File edited successfully');
      }
    });

    it('parses request_metadata with model_id', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation);
      expect(conv!.history[0].request_metadata?.model_id).toBe('claude-sonnet-4-20250514');
    });

    it('parses empty history', () => {
      const conv = KiroSessionParser.parseConversation(emptyConversation);
      expect(conv).not.toBeNull();
      expect(conv!.history).toHaveLength(0);
    });

    it('returns null for invalid JSON', () => {
      const conv = KiroSessionParser.parseConversation('not json');
      expect(conv).toBeNull();
    });

    it('returns null for missing conversation_id', () => {
      const conv = KiroSessionParser.parseConversation(JSON.stringify({ history: [] }));
      expect(conv).toBeNull();
    });

    it('returns null for missing history', () => {
      const conv = KiroSessionParser.parseConversation(
        JSON.stringify({ conversation_id: 'test' }),
      );
      expect(conv).toBeNull();
    });

    it('skips unparseable history entries', () => {
      const json = JSON.stringify({
        conversation_id: 'conv-bad',
        history: [
          { user: 'invalid', assistant: 'invalid' },
          {
            user: {
              content: { Prompt: { prompt: 'Good entry' } },
              timestamp: '2025-01-15T10:00:00Z',
            },
            assistant: {
              Response: { message_id: 'msg-001', content: 'OK' },
            },
          },
        ],
      });
      const conv = KiroSessionParser.parseConversation(json);
      expect(conv!.history).toHaveLength(1);
    });
  });

  // -- toConversationTurns --

  describe('toConversationTurns', () => {
    it('converts minimal conversation to turns', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
    });

    it('user turn has correct text content', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      expect(turns[0].textPreview).toBe('Fix the login bug');
      expect(turns[0].contentBlocks).toHaveLength(1);
      expect(turns[0].contentBlocks[0].kind.type).toBe('text');
      expect(turns[0].contentBlocks[0].text).toBe('Fix the login bug');
    });

    it('assistant turn has correct text content', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      expect(turns[1].textPreview).toBe("I'll fix the login bug for you.");
      expect(turns[1].contentBlocks[0].kind.type).toBe('text');
    });

    it('multi-turn produces 4 turns', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      expect(turns).toHaveLength(4);
      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
      expect(turns[2].role).toBe('user');
      expect(turns[3].role).toBe('assistant');
    });

    it('ToolUse assistant turn has toolUse content block', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      const toolTurn = turns[3]; // second assistant turn
      expect(toolTurn.contentBlocks).toHaveLength(1);
      expect(toolTurn.contentBlocks[0].kind.type).toBe('toolUse');
      const kind = toolTurn.contentBlocks[0].kind as { type: 'toolUse'; name: string };
      expect(kind.name).toBe('editFile');
    });

    it('ToolUseResults user turn has toolResult blocks', () => {
      const conv = KiroSessionParser.parseConversation(toolResultConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      expect(turns[0].role).toBe('user');
      expect(turns[0].contentBlocks).toHaveLength(1);
      expect(turns[0].contentBlocks[0].kind.type).toBe('toolResult');
      expect(turns[0].textPreview).toBe('[tool result x1]');
    });

    it('turn indices are sequential', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      for (let i = 0; i < turns.length; i++) {
        expect(turns[i].index).toBe(i);
      }
    });

    it('line numbers are 1-based', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      expect(turns[0].lineNumber).toBe(1);
      expect(turns[1].lineNumber).toBe(2);
      expect(turns[2].lineNumber).toBe(3);
      expect(turns[3].lineNumber).toBe(4);
    });

    it('timestamps are propagated from user message', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);

      expect(turns[0].timestamp).toBe('2025-01-15T10:00:00Z');
      expect(turns[1].timestamp).toBe('2025-01-15T10:00:00Z');
    });

    it('empty conversation produces no turns', () => {
      const conv = KiroSessionParser.parseConversation(emptyConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);
      expect(turns).toHaveLength(0);
    });

    it('toolUse text preview shows tool name', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation)!;
      const turns = KiroSessionParser.toConversationTurns(conv);
      // The ToolUse assistant turn
      expect(turns[3].textPreview).toBe('[tool: editFile]');
    });
  });

  // -- extractMetadata --

  describe('extractMetadata', () => {
    it('extracts metadata from minimal conversation', () => {
      const metadata = KiroSessionParser.extractMetadata(minimalConversation);

      expect(metadata).not.toBeNull();
      expect(metadata!.sessionId).toBe('conv-abc-123');
      expect(metadata!.messageCount).toBe(1);
      expect(metadata!.firstPrompt).toBe('Fix the login bug');
      expect(metadata!.modelId).toBe('claude-sonnet-4-20250514');
    });

    it('returns null for empty history', () => {
      const metadata = KiroSessionParser.extractMetadata(emptyConversation);
      expect(metadata).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const metadata = KiroSessionParser.extractMetadata('not json');
      expect(metadata).toBeNull();
    });

    it('truncates long first prompt to 500 chars', () => {
      const longPrompt = 'a'.repeat(1000);
      const json = JSON.stringify({
        conversation_id: 'conv-long',
        history: [
          {
            user: {
              content: { Prompt: { prompt: longPrompt } },
              timestamp: '2025-01-15T10:00:00Z',
            },
            assistant: {
              Response: { message_id: 'msg-001', content: 'ok' },
            },
          },
        ],
      });
      const metadata = KiroSessionParser.extractMetadata(json);
      expect(metadata!.firstPrompt!.length).toBe(500);
    });

    it('firstPrompt is null when first entry is ToolUseResults', () => {
      const metadata = KiroSessionParser.extractMetadata(toolResultConversation);
      expect(metadata!.firstPrompt).toBeNull();
    });

    it('messageCount reflects history entries', () => {
      const metadata = KiroSessionParser.extractMetadata(multiTurnConversation);
      expect(metadata!.messageCount).toBe(2);
    });

    it('modelId is null when not present', () => {
      const json = JSON.stringify({
        conversation_id: 'conv-no-model',
        history: [
          {
            user: {
              content: { Prompt: { prompt: 'test' } },
              timestamp: '2025-01-15T10:00:00Z',
            },
            assistant: {
              Response: { message_id: 'msg-001', content: 'ok' },
            },
          },
        ],
      });
      const metadata = KiroSessionParser.extractMetadata(json);
      expect(metadata!.modelId).toBeNull();
    });
  });

  // -- getFullText --

  describe('getFullText', () => {
    it('extracts all text from conversation', () => {
      const conv = KiroSessionParser.parseConversation(minimalConversation)!;
      const text = KiroSessionParser.getFullText(conv);

      expect(text).toContain('Fix the login bug');
      expect(text).toContain("I'll fix the login bug for you.");
    });

    it('joins multiple entries', () => {
      const conv = KiroSessionParser.parseConversation(multiTurnConversation)!;
      const text = KiroSessionParser.getFullText(conv);

      expect(text).toContain('Add dark mode support');
      expect(text).toContain('Let me look at the code.');
      expect(text).toContain('Also add a toggle button');
    });

    it('returns empty for empty conversation', () => {
      const conv = KiroSessionParser.parseConversation(emptyConversation)!;
      const text = KiroSessionParser.getFullText(conv);
      expect(text).toBe('');
    });
  });
});
