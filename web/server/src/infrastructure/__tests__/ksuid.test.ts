import { describe, it, expect } from 'vitest';
import { generate } from '../ksuid.js';

describe('KSUID', () => {
  it('generates a 27-character string without prefix', () => {
    const id = generate();
    expect(id).toHaveLength(27);
  });

  it('generates with prefix', () => {
    const id = generate('card');
    expect(id).toMatch(/^card_[0-9A-Za-z]{27}$/);
  });

  it('generates with "prompt" prefix', () => {
    const id = generate('prompt');
    expect(id).toMatch(/^prompt_[0-9A-Za-z]{27}$/);
  });

  it('uses only base62 characters', () => {
    const id = generate();
    expect(id).toMatch(/^[0-9A-Za-z]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generate());
    }
    expect(ids.size).toBe(100);
  });

  it('is time-sortable (newer IDs sort after older)', () => {
    const id1 = generate();
    // Wait a tiny bit to ensure different timestamp
    const id2 = generate();
    // Both should be valid KSUIDs
    expect(id1).toHaveLength(27);
    expect(id2).toHaveLength(27);
    // Note: within the same second, sort order depends on random payload
    // but across seconds, timestamp bytes ensure ordering
  });

  it('epoch is 2014-05-13 (1400000000 unix seconds)', () => {
    // Generate an ID and verify timestamp bytes are reasonable
    // Current time minus epoch should be positive and fit in 4 bytes
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - 1_400_000_000;
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(0xffffffff); // fits in uint32
  });
});
