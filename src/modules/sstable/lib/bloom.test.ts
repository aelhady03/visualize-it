// Uses node:test + tsx (no build system yet). Port to Vitest mechanically once the Wave 0 scaffold lands.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BLOOM_BITS, emptyBloom, add, maybe, hashPositions } from "./bloom";

describe("bloom (16-bit, k=2, deterministic)", () => {
  it("empty filter never reports a key present", () => {
    assert.equal(maybe(emptyBloom(), "anything"), false);
  });

  it("maybe(added) is always true", () => {
    const bloom = emptyBloom();
    for (const key of ["apple", "banana", "cherry", "date", "elderberry"]) add(bloom, key);
    for (const key of ["apple", "banana", "cherry", "date", "elderberry"]) {
      assert.equal(maybe(bloom, key), true, `added key ${key} must be reported present`);
    }
  });

  it("add mutates in place and returns the same array (for chaining)", () => {
    const bloom = emptyBloom();
    const returned = add(bloom, "kiwi");
    assert.equal(returned, bloom);
    assert.equal(bloom.length, BLOOM_BITS);
    assert.ok(bloom.every((b) => b === 0 || b === 1));
  });

  it("hashPositions is deterministic and pinned to known values", () => {
    // Pins the FNV-1a/djb2 implementation: if these ever change, this fails
    // loudly and every stored fixture bloom breaks with it.
    assert.deepEqual(hashPositions("apple"), [15, 7]);
    assert.deepEqual(hashPositions("apple"), hashPositions("apple"));
  });

  it("hashPositions always lands within [0, 16) and returns k positions", () => {
    for (const key of ["a", "b", "abc", "zzzz", "x".repeat(64)]) {
      const pos = hashPositions(key);
      assert.equal(pos.length, 2);
      for (const p of pos) {
        assert.ok(Number.isInteger(p) && p >= 0 && p < BLOOM_BITS, `${key} → ${p}`);
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
    assert.ok(setBits >= 8, "with 8 keys the filter should be half full");

    let falsePositive: string | null = null;
    for (let i = 0; i < 200 && falsePositive === null; i++) {
      const candidate = `probe-${i}`;
      if (!added.has(candidate) && maybe(bloom, candidate)) falsePositive = candidate;
    }
    assert.ok(falsePositive !== null, "expected to find a false positive among 200 probes");
    assert.ok(!added.has(falsePositive), "the false positive must not be an added key");
  });
});
