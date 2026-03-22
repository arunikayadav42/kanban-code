import { describe, it, expect } from 'vitest';
import { lastAssistantText, textPreview } from '../transcript-notification-reader.js';
import type { ConversationTurn, ContentBlock } from '@kanban-code/shared';

/** Helper to build a ConversationTurn with text blocks. */
function makeTurn(
  role: string,
  texts: string[],
  index = 0,
): ConversationTurn {
  const contentBlocks: ContentBlock[] = texts.map((t) => ({
    kind: { type: 'text' as const },
    text: t,
  }));
  return {
    index,
    lineNumber: 0,
    role,
    textPreview: texts[0] ?? '',
    contentBlocks,
  };
}

/** Helper to build a tool-use content block. */
function makeToolBlock(name: string): ContentBlock {
  return {
    kind: { type: 'toolUse', name, input: {} },
    text: `Tool: ${name}`,
  };
}

describe('TranscriptNotificationReader', () => {
  describe('lastAssistantText', () => {
    it('returns text from the last assistant turn', () => {
      const turns = [
        makeTurn('user', ['Hello']),
        makeTurn('assistant', ['First response']),
        makeTurn('user', ['Follow up']),
        makeTurn('assistant', ['Second response']),
      ];

      expect(lastAssistantText(turns)).toBe('Second response');
    });

    it('returns null for empty turns', () => {
      expect(lastAssistantText([])).toBeNull();
    });

    it('returns null when no assistant turns', () => {
      const turns = [
        makeTurn('user', ['Hello']),
        makeTurn('user', ['Another']),
      ];
      expect(lastAssistantText(turns)).toBeNull();
    });

    it('joins multiple text blocks with newline', () => {
      const turns = [
        makeTurn('assistant', ['Block 1', 'Block 2', 'Block 3']),
      ];

      expect(lastAssistantText(turns)).toBe('Block 1\nBlock 2\nBlock 3');
    });

    it('filters out non-text blocks (tool use)', () => {
      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 0,
        role: 'assistant',
        textPreview: '',
        contentBlocks: [
          { kind: { type: 'text' }, text: 'I will read the file.' },
          makeToolBlock('Read'),
          { kind: { type: 'text' }, text: 'Here are the results.' },
        ],
      };

      expect(lastAssistantText([turn])).toBe(
        'I will read the file.\nHere are the results.',
      );
    });

    it('returns null when last assistant turn has only tool blocks', () => {
      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 0,
        role: 'assistant',
        textPreview: '',
        contentBlocks: [makeToolBlock('Read'), makeToolBlock('Write')],
      };

      expect(lastAssistantText([turn])).toBeNull();
    });

    it('trims whitespace from result', () => {
      const turns = [makeTurn('assistant', ['  hello world  '])];
      expect(lastAssistantText(turns)).toBe('hello world');
    });

    it('returns null when text is only whitespace', () => {
      const turns = [makeTurn('assistant', ['   ', '\n\n'])];
      expect(lastAssistantText(turns)).toBeNull();
    });

    it('ignores thinking blocks', () => {
      const turn: ConversationTurn = {
        index: 0,
        lineNumber: 0,
        role: 'assistant',
        textPreview: '',
        contentBlocks: [
          { kind: { type: 'thinking' }, text: 'Let me think...' },
          { kind: { type: 'text' }, text: 'Here is my answer.' },
        ],
      };

      expect(lastAssistantText([turn])).toBe('Here is my answer.');
    });
  });

  describe('textPreview', () => {
    it('returns first line when >= 42 chars', () => {
      const longLine = 'This is a fairly long first line that is definitely over 42 characters in length';
      const text = longLine + '\nSecond line here';

      expect(textPreview(text)).toBe(longLine);
    });

    it('returns first line exactly at 42 chars', () => {
      const line42 = 'a'.repeat(42);
      expect(textPreview(line42)).toBe(line42);
    });

    it('accumulates sentences for short first line', () => {
      const text = 'Short. Another sentence. Yet more text.';
      const result = textPreview(text);

      // Should accumulate sentences until > 140 chars (or run out)
      expect(result).toContain('Short.');
      expect(result).toContain('Another sentence.');
    });

    it('stops accumulating at > 140 chars', () => {
      const s1 = 'A'.repeat(50);
      const s2 = 'B'.repeat(50);
      const s3 = 'C'.repeat(50);
      const s4 = 'D'.repeat(50);
      // Use newline so the first line is short (< 42), forcing sentence accumulation
      const text = `Short\n${s1}.${s2}.${s3}.${s4}.`;

      const result = textPreview(text);
      // Sentences: ["Short\nAAA(50)", "BBB(50)", "CCC(50)", "DDD(50)", ""]
      // s1 block + "." -> ~56 chars, + s2 + "." -> ~107, + s3 + "." -> ~158 > 140 -> stop
      expect(result.length).toBeGreaterThan(140);
      expect(result).toContain(s3);
      expect(result).not.toContain(s4);
    });

    it('accumulates single sentence without period into sentence+dot', () => {
      // "Hi" split by "." = ["Hi"], accumulated = "Hi." (non-empty), returned
      const text = 'Hi';
      expect(textPreview(text)).toBe('Hi.');
    });

    it('handles text with no periods', () => {
      const text = 'Short text with no period endings';
      // First line < 42, sentences = ['Short text with no period endings']
      // Accumulated = 'Short text with no period endings.'
      const result = textPreview(text);
      expect(result).toBe('Short text with no period endings.');
    });

    it('handles single very long line', () => {
      const longLine = 'X'.repeat(200);
      expect(textPreview(longLine)).toBe(longLine);
    });

    it('skips empty sentences from consecutive periods', () => {
      const text = 'Hello..World.';
      const result = textPreview(text);
      // Splits on "." -> ["Hello", "", "World", ""]
      // Skips empty, accumulates "Hello." then "World."
      expect(result).toBe('Hello.World.');
    });

    it('handles multiline with short lines', () => {
      const text = 'Line one.\nLine two is here. And more.';
      // First line "Line one." is < 42 chars
      // Sentences split by ".": ["Line one", "\nLine two is here", " And more", ""]
      // Accumulates until > 140 or exhausted
      const result = textPreview(text);
      expect(result).toContain('Line one.');
    });
  });
});
