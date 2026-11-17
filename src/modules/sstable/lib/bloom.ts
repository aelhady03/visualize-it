/**
 * Teaching-size bloom filter over string keys (PLAN.md §5.1 `SSTable.bloom`).
 *
 * - 16 bits wide, k = 2 deterministic 32-bit hashes (FNV-1a + djb2), each
 *   reduced mod 16. `hashPositions` is exported so the UI can show which
 *   bits a key flips.
 * - Deterministic: no randomness anywhere. Same key → same bit positions
 *   forever, across runs and machines (all arithmetic is 32-bit unsigned).
 *
 * ⚠ 16-bit filters false-positive often BY DESIGN. With a handful of keys
 *   most bits are set and ~half of all probes report "maybe". That is the
 *   point: the false-positive read path (§5.2 Read) has to be demonstrable
 *   in a classroom, and a real-world 10-bit-per-key filter would almost
 *   never show one. Do not "fix" this by growing the filter.
 */

export const BLOOM_BITS = 16;
export const BLOOM_HASHES = 2;

/** Bit array of 0/1, length BLOOM_BITS. Plain number[] so it stays JSON. */
export type BloomFilter = number[];

/** FNV-1a 32-bit, kept in unsigned 32-bit space for cross-platform determinism. */
function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** djb2 32-bit (xor variant not used; classic `hash * 33 + c`), unsigned 32-bit. */
function djb2_32(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 33) + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * The bit indexes [0, BLOOM_BITS) this key maps to — k = 2 positions, one
 * per hash. The two hashes may collide onto the same index; that is fine
 * (the filter still answers correctly, just with slightly higher FP odds).
 */
export function hashPositions(key: string): number[] {
  return [fnv1a32(key) % BLOOM_BITS, djb2_32(key) % BLOOM_BITS];
}

/** A fresh all-zero filter. */
export function emptyBloom(): BloomFilter {
  return new Array<number>(BLOOM_BITS).fill(0);
}

/**
 * Set the key's bits. Mutates `bloom` in place (the flush path builds the
 * array once and stores it) and also returns it for chaining.
 */
export function add(bloom: BloomFilter, key: string): BloomFilter {
  for (const p of hashPositions(key)) bloom[p] = 1;
  return bloom;
}

/** "Maybe present": true if every bit the key maps to is set. */
export function maybe(bloom: BloomFilter, key: string): boolean {
  return hashPositions(key).every((p) => bloom[p] === 1);
}
