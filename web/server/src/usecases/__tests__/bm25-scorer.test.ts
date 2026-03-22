import { describe, it, expect } from 'vitest';
import { score, recencyBoost, tokenize, K1, B } from '../bm25-scorer.js';

/**
 * Port of Tests/KanbanCodeCoreTests/BM25Tests.swift (127 lines, 11 test cases)
 */

describe('BM25Scorer', () => {
  it('exports correct constants', () => {
    expect(K1).toBe(1.2);
    expect(B).toBe(0.4);
  });

  describe('tokenize', () => {
    it('splits and lowercases', () => {
      const tokens = tokenize('Fix the Login Bug in AuthService');
      expect(tokens).toContain('fix');
      expect(tokens).toContain('login');
      expect(tokens).toContain('bug');
      expect(tokens).toContain('authservice');
      expect(tokens).toContain('the'); // 3 chars >= 2 min length
    });

    it('strips punctuation', () => {
      const tokens = tokenize('hello, world! foo_bar');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('foo');
      expect(tokens).toContain('bar');
    });

    it('filters tokens shorter than 2 chars', () => {
      const tokens = tokenize('I am a test');
      // "I" and "a" are < 2 chars, should be filtered
      expect(tokens).not.toContain('i');
      expect(tokens).not.toContain('a');
      expect(tokens).toContain('am');
      expect(tokens).toContain('test');
    });
  });

  describe('score', () => {
    it('returns zero for no matching terms', () => {
      const s = score(
        ['xyz'],
        ['hello', 'world'],
        10,
        5,
        { hello: 3, world: 2 },
      );
      expect(s).toBe(0);
    });

    it('returns positive for matching terms', () => {
      const s = score(
        ['hello'],
        ['hello', 'world', 'hello'],
        10,
        5,
        { hello: 2, world: 3 },
      );
      expect(s).toBeGreaterThan(0);
    });

    it('higher term frequency -> higher score', () => {
      const score1 = score(
        ['hello'],
        ['hello', 'world'],
        10,
        5,
        { hello: 2 },
      );
      const score2 = score(
        ['hello'],
        ['hello', 'hello', 'hello', 'world'],
        10,
        5,
        { hello: 2 },
      );
      expect(score2).toBeGreaterThan(score1);
    });

    it('rarer terms get higher IDF', () => {
      const commonScore = score(
        ['the'],
        ['the', 'cat'],
        10,
        100,
        { the: 90 },
      );
      const rareScore = score(
        ['quantum'],
        ['quantum', 'cat'],
        10,
        100,
        { quantum: 2 },
      );
      expect(rareScore).toBeGreaterThan(commonScore);
    });

    it('multi-term query scores higher when all terms present', () => {
      const oneTermScore = score(
        ['login', 'bug'],
        ['login', 'page', 'form'],
        10,
        5,
        { login: 2, bug: 1 },
      );
      const bothTermsScore = score(
        ['login', 'bug'],
        ['login', 'bug', 'fix'],
        10,
        5,
        { login: 2, bug: 1 },
      );
      expect(bothTermsScore).toBeGreaterThan(oneTermScore);
    });

    it('returns zero for empty document', () => {
      expect(score(['hello'], [], 10, 5, { hello: 2 })).toBe(0);
    });

    it('returns zero for zero avgDocLength', () => {
      expect(score(['hello'], ['hello'], 0, 5, { hello: 2 })).toBe(0);
    });

    it('applies recency boost multiplier', () => {
      const base = score(
        ['hello'],
        ['hello', 'world'],
        10,
        5,
        { hello: 2 },
        1.0,
      );
      const boosted = score(
        ['hello'],
        ['hello', 'world'],
        10,
        5,
        { hello: 2 },
        2.0,
      );
      expect(boosted).toBeCloseTo(base * 2, 5);
    });

    it('prefix matching for terms >= 3 chars', () => {
      // "auth" should match "authentication" via prefix
      const s = score(
        ['auth'],
        ['authentication', 'service'],
        10,
        5,
        { authentication: 2 },
      );
      expect(s).toBeGreaterThan(0);
    });

    it('no prefix matching for terms < 3 chars', () => {
      // "au" should NOT prefix-match "authentication"
      const s = score(
        ['au'],
        ['authentication', 'service'],
        10,
        5,
        { authentication: 2 },
      );
      expect(s).toBe(0);
    });
  });

  describe('recencyBoost', () => {
    it('recent file gets boost >= 1.9', () => {
      const boost = recencyBoost(new Date());
      expect(boost).toBeGreaterThanOrEqual(1.9);
    });

    it('old file (60 days) gets boost of 1.0', () => {
      const boost = recencyBoost(new Date(Date.now() - 86400_000 * 60));
      expect(boost).toBe(1.0);
    });

    it('decays linearly (~2.0 at 15 days)', () => {
      const boost15d = recencyBoost(new Date(Date.now() - 86400_000 * 15));
      expect(boost15d).toBeGreaterThan(1.0);
      expect(boost15d).toBeLessThan(3.0);
      expect(Math.abs(boost15d - 2.0)).toBeLessThan(0.1);
    });

    it('future date returns 3.0', () => {
      const boost = recencyBoost(new Date(Date.now() + 86400_000));
      expect(boost).toBe(3.0);
    });
  });
});
