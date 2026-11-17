import { describe, it, expect } from "vitest";
import { BLOOM_BITS, emptyBloom, add, maybe, hashPositions } from "./bloom";

describe("bloom (16-bit, k=2, deterministic)", () => {
  it("empty filter never reports a key present", () => {
    expect(maybe(emptyBloom(), "anything")).toBe(false);
  });

  it("maybe(added) is always true", () => {
    const bloom = emptyBloom();
    for (const key of ["apple", "banana", "cherry", "date", "elderberry"]) add(bloom, key);
    for (const key of ["apple", "banana", "cherry", "date", "elderberry"]) {
      expect(maybe(bloom, key)).toBe(true);
    }
  });

  it("add mutates in place and returns the same array (for chaining)", () => {
    const bloom = emptyBloom();
    const returned = add(bloom, "kiwi");
    expect(returned).toBe(bloom);
    expect(bloom.length).toBe(BLOOM_BITS);
    expect(bloom.every((b) => b === 0 || b === 1)).toBe(true);
  });

  it("hashPositions is deterministic and pinned to known values", () => {
    // Pins the FNV-1a/djb2 implementation: if these ever change, this fails
    // loudly and every stored fixture bloom breaks with it.
    expect(hashPositions("apple")).toEqual([15, 7]);
    expect(hashPositions("apple")).toEqual(hashPositions("apple"));
  });

  it("hashPositions always lands within [0, 16) and returns k positions", () => {
    for (const key of ["a", "b", "abc", "zzzz", "x".repeat(64)]) {
      const pos = hashPositions(key);
      expect(pos.length).toBe(2);
      for (const p of pos) {
        expect(Number.isInteger(p) && p >= 0 && p < BLOOM_BITS).toBe(true);
      }
    }
  });

  it("DEMONSTRATES a real false positive: a key that filters 'maybe' but was never added", () => {
    // 16 bits by design: with a handful of keys most bits are set and false
    // positives are COMMON — this is a teaching feature, not a bug.
    const bloom = emptyBloom();
    const added = new Set(["apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "kiwi"]);
    for (const key of added) add(bloom, key);

    const setBits = bloom.filter((b) => b === 1).length;
    expect(setBits >= 8).toBe(true);

    let falsePositive: string | null = null;
    for (let i = 0; i < 200 && falsePositive === null; i++) {
      const candidate = `probe-${i}`;
      if (!added.has(candidate) && maybe(bloom, candidate)) falsePositive = candidate;
    }
    expect(falsePositive !== null).toBe(true);
    expect(!added.has(falsePositive!)).toBe(true);
  });
});
