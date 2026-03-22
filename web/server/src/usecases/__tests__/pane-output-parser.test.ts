import { describe, it, expect } from 'vitest';
import { countImages, isReady, isClaudeReady } from '../pane-output-parser.js';

describe('PaneOutputParser', () => {
  describe('countImages', () => {
    it('counts zero when no images present', () => {
      expect(countImages('hello world')).toBe(0);
    });

    it('counts a single image occurrence', () => {
      expect(countImages('some text [Image #1] more text')).toBe(1);
    });

    it('counts multiple image occurrences on separate lines', () => {
      const output = '[Image #1] first\n[Image #2] second\n[Image #3] third';
      expect(countImages(output)).toBe(3);
    });

    it('counts multiple images on a single line', () => {
      const output = '[Image #1] [Image #2] [Image #3]';
      expect(countImages(output)).toBe(3);
    });

    it('counts zero for empty string', () => {
      expect(countImages('')).toBe(0);
    });

    it('does not count partial matches', () => {
      expect(countImages('[Image')).toBe(0);
      expect(countImages('Image #1')).toBe(0);
    });

    it('counts high-numbered images', () => {
      expect(countImages('[Image #42] attached')).toBe(1);
    });
  });

  describe('isReady', () => {
    it('returns true when claude prompt character is present', () => {
      expect(isReady('some output ❯ ', 'claude')).toBe(true);
    });

    it('returns false when claude prompt character is absent', () => {
      expect(isReady('some output without prompt', 'claude')).toBe(false);
    });

    it('returns true when gemini prompt text is present', () => {
      expect(isReady('Type your message here', 'gemini')).toBe(true);
    });

    it('returns false when gemini prompt text is absent', () => {
      expect(isReady('some gemini output', 'gemini')).toBe(false);
    });
  });

  describe('isClaudeReady', () => {
    it('returns true when prompt character is visible', () => {
      expect(isClaudeReady('❯ ')).toBe(true);
    });

    it('returns false when prompt character is not visible', () => {
      expect(isClaudeReady('processing...')).toBe(false);
    });
  });
});
