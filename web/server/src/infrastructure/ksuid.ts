import crypto from 'crypto';

/**
 * Lightweight KSUID (K-Sortable Unique Identifier) generator.
 *
 * Format: 4-byte timestamp (seconds since epoch 2014-05-13) + 16-byte random payload,
 * base62-encoded to 27 characters. Naturally sortable by creation time.
 *
 * Swift source: Sources/KanbanCodeCore/Infrastructure/KSUID.swift
 * Spec: Section 7 (Infrastructure)
 */

/** KSUID epoch: 2014-05-13T16:53:20Z (1400000000 unix seconds) */
const KSUID_EPOCH = 1_400_000_000;
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ENCODED_LENGTH = 27;

/**
 * Generate a new KSUID, optionally with a prefix.
 * @example generate('card') → "card_2MtCMwXZOHPSlEMDe7OYW6bRfXX"
 * @example generate() → "2MtCMwXZOHPSlEMDe7OYW6bRfXX"
 */
export function generate(prefix?: string): string {
  const timestamp = Math.floor(Date.now() / 1000) - KSUID_EPOCH;

  // 4-byte timestamp (big-endian) + 16-byte random payload = 20 bytes
  const bytes = new Uint8Array(20);
  bytes[0] = (timestamp >>> 24) & 0xff;
  bytes[1] = (timestamp >>> 16) & 0xff;
  bytes[2] = (timestamp >>> 8) & 0xff;
  bytes[3] = timestamp & 0xff;

  // Fill 16 random bytes
  const random = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) {
    bytes[4 + i] = random[i];
  }

  const encoded = base62Encode(bytes);
  return prefix ? `${prefix}_${encoded}` : encoded;
}

/**
 * Base62-encode a 20-byte array into a 27-character string.
 * Uses big-endian arithmetic division to produce a fixed-width output.
 */
function base62Encode(bytes: Uint8Array): string {
  // Work on a mutable copy
  const number = new Uint8Array(bytes);
  const result = new Array<string>(ENCODED_LENGTH).fill('0');

  for (let i = ENCODED_LENGTH - 1; i >= 0; i--) {
    let remainder = 0;
    for (let j = 0; j < number.length; j++) {
      const value = number[j] + remainder * 256;
      number[j] = Math.floor(value / 62);
      remainder = value % 62;
    }
    result[i] = BASE62_CHARS[remainder];
  }

  return result.join('');
}
