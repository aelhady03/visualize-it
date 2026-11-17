import { describe, it, expect } from "vitest";
import type { Entry } from "../state";
import { mergeRuns, mergePair, keepAllTombstones, type KeepTombstone } from "./merge";

/** Deterministic PRNG (mulberry32) — local so this module stays dependency-free. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entry(id: string, key: string, value: string, seq: number, tombstone = false): Entry {
  return tombstone ? { id, key, value, seq, tombstone: true } : { id, key, value, seq };
}

// ---------------------------------------------------------------------------
// The R1 counter-example (PLAN.md re-verification): run A has x=v1@seq1,
// run B has x=v2@seq3, run C has no x but a HIGHER maxSeq. The merge must
// keep x=v2 — run order / file order / run maxSeq must never decide.
// ---------------------------------------------------------------------------

describe("mergeRuns: max-seq reconciliation (R1 counter-example)", () => {
  const runA: Entry[] = [entry("a1", "x", "v1", 1)];
  const runB: Entry[] = [entry("b1", "x", "v2", 3)];
  const runC: Entry[] = [entry("c1", "y", "big", 9)]; // no x, but maxSeq 9 > 3

  it("keeps the highest-seq entry for x regardless of run order", () => {
    const out = mergeRuns([runA, runB, runC]);
    expect(
      out.map((e) => [e.key, e.value, e.seq]),
    ).toEqual([
      ["x", "v2", 3],
      ["y", "big", 9],
    ]);
  });

  it("is order-independent: reversed run order gives the same output", () => {
    const fwd = mergeRuns([runA, runB, runC]);
    const rev = mergeRuns([runC, runB, runA]);
    expect(rev).toEqual(fwd);
    // and runC's higher maxSeq must not suppress x
    expect(rev.some((e) => e.key === "x" && e.value === "v2")).toBe(true);
  });

  it("agrees with pairwise merges", () => {
    const kway = mergeRuns([runA, runB, runC]);
    const pairwise = mergePair(mergePair(runA, runB), runC);
    expect(kway).toEqual(pairwise);
  });
});

// ---------------------------------------------------------------------------
// Tombstone policy hook
// ---------------------------------------------------------------------------

describe("mergeRuns: keepTombstone policy", () => {
  const olderValue: Entry[] = [entry("a1", "x", "v1", 1)];
  const tomb: Entry[] = [entry("b1", "x", "", 3, true)];

  it("keeps the tombstone under the default policy", () => {
    const out = mergeRuns([olderValue, tomb]);
    expect(out).toEqual([tomb[0]]);
  });

  it("drops the whole key when the policy rejects the tombstone", () => {
    const out = mergeRuns([olderValue, tomb], () => false);
    expect(out).toEqual([]);
  });

  it("hands the policy every entry for the key across all runs", () => {
    let seen: Entry[] = [];
    const policy: KeepTombstone = (_entry, group) => {
      seen = group;
      return true;
    };
    mergeRuns([olderValue, tomb], policy);
    expect(seen.length).toBe(2);
    expect(seen.map((e) => e.seq).sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it("never consults the policy when the winner is a live value (older tombstone loses)", () => {
    let calls = 0;
    const policy: KeepTombstone = () => {
      calls++;
      return true;
    };
    // tombstone seq 2 loses to live value seq 3
    const out = mergeRuns([[entry("a1", "x", "", 2, true)], [entry("b1", "x", "v", 3)]], policy);
    expect(out).toEqual([entry("b1", "x", "v", 3)]);
    expect(calls).toBe(0);
  });

  it("keeps distinct keys and full sort order", () => {
    const out = mergeRuns([
      [entry("a1", "a", "1", 1), entry("a2", "c", "1", 2)],
      [entry("b1", "b", "2", 5)],
    ]);
    expect(out.map((e) => e.key)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// k-way output === repeated pairwise merges, on seeded random inputs
// ---------------------------------------------------------------------------

function randomRuns(seed: number): Entry[][] {
  const rnd = mulberry32(seed);
  const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((c) => `key-${c}`);
  const runCount = 3 + Math.floor(rnd() * 3); // 3..5 runs
  const runs: Entry[][] = [];
  let seq = 1;
  for (let r = 0; r < runCount; r++) {
    const size = 2 + Math.floor(rnd() * 6); // 2..7 entries
    const keys = new Set<string>();
    while (keys.size < size) keys.add(alphabet[Math.floor(rnd() * alphabet.length)]);
    const sortedKeys = [...keys].sort(); // same code-unit order mergeRuns uses
    runs.push(
      sortedKeys.map((key) => {
        const isTomb = rnd() < 0.2;
        const value = isTomb ? (rnd() < 0.5 ? "" : "del") : `v${seq}`;
        return isTomb
          ? { id: `e${seq}`, key, value, seq: seq++, tombstone: true }
          : { id: `e${seq}`, key, value, seq: seq++ };
      }),
    );
  }
  return runs;
}

function maxSeqForKey(runs: Entry[][], key: string): Entry | null {
  let best: Entry | null = null;
  for (const run of runs) {
    for (const e of run) {
      if (e.key === key && (best === null || e.seq > best.seq)) best = e;
    }
  }
  return best;
}

// Stateless policy: a tombstone survives iff its value is non-empty.
// Stateless policies compose under pairwise folding (see merge.ts docs).
const keepNonEmptyTombstones: KeepTombstone = (e) => e.value !== "";

function foldPairwise(runs: Entry[][], policy: KeepTombstone): Entry[] {
  let acc: Entry[] = [];
  for (const run of runs) acc = mergePair(acc, run, policy);
  return acc;
}

describe("mergeRuns: k-way equals repeated pairwise merges (seeded random)", () => {
  for (const seed of [1, 42, 2026]) {
    it(`seed ${seed}: output matches the pairwise fold under both policies`, () => {
      const runs = randomRuns(seed);

      for (const policy of [keepAllTombstones, keepNonEmptyTombstones]) {
        const kway = mergeRuns(runs, policy);
        const folded = foldPairwise(runs, policy);

        expect(kway).toEqual(folded);

        // independent checks on the k-way output itself
        expect(kway.every((e, i) => i === 0 || kway[i - 1].key < e.key)).toBe(true);
        for (const e of kway) {
          const best = maxSeqForKey(runs, e.key);
          expect(best).toBeTruthy();
          expect(e.seq).toBe(best!.seq);
        }
      }
    });

    it(`seed ${seed}: every dropped key really was a dropped tombstone`, () => {
      const runs = randomRuns(seed);
      const kway = mergeRuns(runs, keepNonEmptyTombstones);
      const present = new Set(kway.map((e) => e.key));
      for (const run of runs) {
        for (const e of run) {
          if (present.has(e.key)) continue;
          const best = maxSeqForKey(runs, e.key);
          expect(best).toBeTruthy();
          expect(best!.tombstone).toBe(true);
          expect(best!.value).toBe("");
        }
      }
    });
  }
});
