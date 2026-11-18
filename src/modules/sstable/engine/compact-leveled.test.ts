/**
 * Tests for the leveled compaction lane (engine/compact-leveled.ts).
 *
 * Per PLAN.md §8: assert step `kind` sequences and state invariants — never
 * narration wording. Coverage:
 * - L0 spill kind sequence (pick → merge×3 → complete → idle) + invariants
 * - single-input compaction completes within one press
 * - L1+ disjointness + per-key seq decreasing after merges
 * - output splitting at targetFileSize
 * - tombstone GC rule: dropped (bottommost / no lower coverage) vs kept
 * - Ln→Ln+1 pick by level target + size score
 * - property tests: random writes + leveled compactions keep every read's
 *   answer (local reference walk) matching a reference Map; determinism.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { init, run } from "./index";
import type { EngineState, Entry, SSTable } from "../state";
import { buildSSTable } from "./jobs";
import {
  entryBytes,
  hasDuplicateKeysWithinFile,
  isSorted,
  levelRangesDisjoint,
  seqDecreasesDownLevels,
  sstableEntries,
  sstableMaxKey,
  sstableMinKey,
} from "../lib/derive";
import { levelTargetBytes } from "./compact-leveled";

const kindOf = (s: { kind: string }) => s.kind;

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

function leveled(config: Record<string, string | number | boolean> = {}): EngineState {
  return init({ strategy: "leveled", ...config });
}

function ent(id: string, key: string, value: string, seq: number, tombstone?: boolean): Entry {
  return tombstone ? { id, key, value, seq, tombstone: true } : { id, key, value, seq };
}

function mkSst(id: string, entries: Entry[]): SSTable {
  return buildSSTable(id, entries, 2);
}

/** Hand-crafted leveled state with consistent metrics and a valid seq clock. */
function craft(partial: {
  l0?: SSTable[];
  levels?: SSTable[][];
  config?: Record<string, string | number | boolean>;
}): EngineState {
  const base = leveled(partial.config);
  const l0 = partial.l0 ?? [];
  const levels = partial.levels ?? [];
  const files = [...l0, ...levels.flat()];
  const fileBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const maxSeq = files.reduce((m, f) => Math.max(m, f.seq), 0);
  return {
    ...base,
    l0,
    levels,
    seq: Math.max(base.seq, maxSeq + 1),
    metrics: {
      ingestedBytes: 0,
      bytesWritten: fileBytes,
      diskBytes: fileBytes,
      lastReadFiles: 0,
      lastReadBlocks: 0,
    },
  };
}

/** Local reference walk: the read answer for one key over the whole state. */
function walkKey(state: EngineState, key: string): string | null {
  const candidates: Entry[] = [];
  for (const mt of state.memtables) for (const e of mt.entries) if (e.key === key) candidates.push(e);
  for (let i = state.l0.length - 1; i >= 0; i--) {
    const sst = state.l0[i];
    const min = sstableMinKey(sst);
    const max = sstableMaxKey(sst);
    if (min === null || max === null || !(min <= key && key <= max)) continue;
    for (const e of sstableEntries(sst)) if (e.key === key) candidates.push(e);
  }
  for (const level of state.levels) {
    for (const sst of level) {
      const min = sstableMinKey(sst);
      const max = sstableMaxKey(sst);
      if (min === null || max === null || !(min <= key && key <= max)) continue;
      for (const e of sstableEntries(sst)) if (e.key === key) candidates.push(e);
    }
  }
  let best: Entry | null = null;
  for (const e of candidates) {
    if (best === null || e.seq > best.seq) best = e;
  }
  if (best === null) return null;
  return best.tombstone === true ? null : best.value;
}

function expectInvariants(state: EngineState): void {
  for (const sst of [...state.l0, ...state.levels.flat()]) {
    expect(isSorted(sstableEntries(sst))).toBe(true);
    expect(hasDuplicateKeysWithinFile(sst)).toBe(false);
    const maxSeq = sstableEntries(sst).reduce((m, e) => Math.max(m, e.seq), 0);
    expect(sst.seq).toBe(maxSeq);
  }
  for (const level of state.levels) expect(levelRangesDisjoint(level)).toBe(true);
  expect(seqDecreasesDownLevels(state)).toEqual([]);
  for (const sst of [...state.l0, ...state.levels.flat()]) {
    for (const e of sstableEntries(sst)) expect(state.seq > e.seq).toBe(true);
  }
  const fileBytes = [...state.l0, ...state.levels.flat()].reduce((s, f) => s + f.bytes, 0);
  const walBytes = state.wal.reduce(
    (s, w) => s + w.entries.reduce((x, e) => x + entryBytes(e), 0),
    0,
  );
  expect(state.metrics.diskBytes).toBe(fileBytes + walBytes);
  expect(state.metrics.bytesWritten).toBeGreaterThanOrEqual(fileBytes);
}

/**
 * 25 writes over keys k01..k15 with 3-key overlap between consecutive
 * flushes (memtableCap 6): after write 25 L0 holds 4 mutually overlapping
 * files, forming one overlap group.
 */
const spillWrites: Array<{ key: string; value: string }> =
  "k01 k02 k03 k04 k05 k06 k04 k05 k06 k07 k08 k09 k07 k08 k09 k10 k11 k12 k10 k11 k12 k13 k14 k15 k13"
    .split(" ")
    .map((key) => ({ key, value: `v${key.slice(1)}` }));

function driveSpillWrites(): EngineState {
  let s = leveled();
  for (const w of spillWrites) s = run("write", { key: w.key, value: w.value }, s).result;
  return s;
}

describe("leveled compaction: L0 spill kind sequence", () => {
  it("picks the whole overlapping group, advances 1 unit per press, completes, then idles", () => {
    const s0 = driveSpillWrites();
    expect(s0.l0.length).toBe(4);
    expect(s0.jobs).toEqual([]);

    const p1 = run("compact", {}, s0);
    expect(p1.steps.map(kindOf)).toEqual(["compact.pick", "compact.merge", "compact.stall"]);
    const s1 = p1.result;
    expect(s1.jobs.length).toBe(1);
    expect(s1.jobs[0].kind).toBe("compaction");
    expect(s1.jobs[0].inputs.length).toBe(4);
    expect(s1.jobs[0].progress).toBe(1);
    expect(s1.jobs[0].total).toBe(4);
    expect(s1.jobs[0].output.length).toBeGreaterThan(0);
    expect(s1.l0.length).toBe(4); // inputs stay until completion

    const p2 = run("compact", {}, s1);
    expect(p2.steps.map(kindOf)).toEqual(["compact.merge", "compact.stall"]);
    expect(p2.result.jobs[0].progress).toBe(2);

    const p3 = run("compact", {}, p2.result);
    expect(p3.steps.map(kindOf)).toEqual(["compact.merge", "compact.stall"]);
    expect(p3.result.jobs[0].progress).toBe(3);

    const p4 = run("compact", {}, p3.result);
    expect(p4.steps.map(kindOf)).toEqual(["compact.merge", "compact.complete"]);
    const s4 = p4.result;
    expect(s4.jobs).toEqual([]);
    expect(s4.l0).toEqual([]);
    expect(s4.levels.length).toBe(1);

    const p5 = run("compact", {}, s4);
    expect(p5.steps.map(kindOf)).toEqual(["compact.idle"]);
    expect(p5.result).toEqual(s4);
  });

  it("a single-input compaction completes within one press (no stall after)", () => {
    const s = craft({ l0: [mkSst("s1", [ent("e1", "k1", "v1", 1)])], config: { l0Trigger: 1 } });
    const r = run("compact", {}, s);
    expect(r.steps.map(kindOf)).toEqual(["compact.pick", "compact.merge", "compact.complete"]);
    expect(r.error).toBeUndefined();
    expect(r.result.jobs).toEqual([]);
    expect(r.result.l0).toEqual([]);
    expect(r.result.levels.length).toBe(1);
  });
});

describe("leveled compaction: invariants after the spill", () => {
  it("L1 is disjoint, per-key seq decreases, every file stays sorted and unique", () => {
    let s = driveSpillWrites();
    for (let i = 0; i < 4; i++) {
      const r = run("compact", {}, s);
      expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
      s = r.result;
    }
    expect(s.l0).toEqual([]);
    expect(s.levels.length).toBe(1);
    expectInvariants(s);
    // 15 distinct keys merged into L1 (highest seq wins; stale versions gone)
    const keys = s.levels.flat().flatMap((f) => sstableEntries(f).map((e) => e.key));
    expect(new Set(keys).size).toBe(15);
    expect(keys).toEqual([...keys].sort());
    // L1 total is below its budget (targetFileSize × fanout^1 = 384)
    const total = s.levels[0].reduce((sum, f) => sum + f.bytes, 0);
    expect(total).toBeLessThanOrEqual(levelTargetBytes({ targetFileSize: 128, fanout: 3 }, 1));
    // every read answer survives the merge
    for (const key of keys) expect(walkKey(s, key)).not.toBeNull();
  });
});

describe("leveled compaction: output splitting at targetFileSize", () => {
  it("splits the merged stream into disjoint files no larger than the target", () => {
    const entries = [1, 2, 3, 4, 5, 6].map((i) => ent(`e${i}`, `k${i}`, "v", i));
    const s = craft({
      l0: [mkSst("s1", entries)],
      config: { l0Trigger: 1, targetFileSize: 40 },
    });
    const r = run("compact", {}, s);
    expect(r.error).toBeUndefined();
    const out = r.result.levels[0];
    expect(out.length).toBeGreaterThan(1); // 6 × 13B ≈ 78B → 2 files of ≤ 40B
    for (const f of out) {
      expect(f.bytes).toBeLessThanOrEqual(40);
    }
    expect(levelRangesDisjoint(out)).toBe(true);
    const keys = out.flatMap((f) => sstableEntries(f).map((e) => e.key));
    expect(keys).toEqual(["k1", "k2", "k3", "k4", "k5", "k6"]);
    // inputs removed, outputs counted once (on top of the crafted baseline)
    expect(r.result.l0).toEqual([]);
    const outBytes = out.reduce((sum, f) => sum + f.bytes, 0);
    expect(r.result.metrics.bytesWritten).toBe(s.metrics.bytesWritten + outBytes);
    expect(r.result.metrics.diskBytes).toBe(outBytes);
  });

  it("a single entry larger than the target still gets its own file", () => {
    const big = ent("e1", "a-very-long-key", "a-very-long-value", 1);
    const s = craft({
      l0: [mkSst("s1", [big, ent("e2", "k2", "v", 2)])],
      config: { l0Trigger: 1, targetFileSize: 10 },
    });
    const r = run("compact", {}, s);
    const out = r.result.levels[0];
    expect(out.length).toBe(2); // one oversized file + the rest
    expect(levelRangesDisjoint(out)).toBe(true);
    const keys = out.flatMap((f) => sstableEntries(f).map((e) => e.key));
    expect(keys).toEqual(["a-very-long-key", "k2"]);
  });
});

describe("leveled compaction: tombstone GC rule", () => {
  it("drops a tombstone when the output level is the bottommost", () => {
    const s = craft({
      l0: [mkSst("s1", [ent("e1", "k1", "v1", 1), ent("e2", "k2", "v2", 2, true)])],
      config: { l0Trigger: 1, targetFileSize: 999 },
    });
    const r = run("compact", {}, s);
    expect(r.error).toBeUndefined();
    const entries = r.result.levels.flat().flatMap((f) => sstableEntries(f));
    expect(entries.map((e) => e.key)).toEqual(["k1"]); // k2 GC'd entirely
    expect(walkKey(r.result, "k1")).toBe("v1");
    expect(walkKey(r.result, "k2")).toBeNull();
  });

  it("keeps a tombstone when a lower level still covers its key", () => {
    const s = craft({
      l0: [mkSst("s1", [ent("e4", "k1", "v1", 4), ent("e5", "k2", "gone", 5, true)])],
      levels: [
        [mkSst("l1a", [ent("e2", "k2", "old", 3), ent("e3", "k3", "v3", 2)])],
        [mkSst("l2a", [ent("e1", "k2", "oldest", 1)])],
      ],
      config: { l0Trigger: 1, targetFileSize: 999 },
    });
    // two inputs (s1 + overlapping l1a) → total 2 → two presses
    const p1 = run("compact", {}, s);
    expect(p1.steps.map(kindOf)).toEqual(["compact.pick", "compact.merge", "compact.stall"]);
    const p2 = run("compact", {}, p1.result);
    expect(p2.steps.map(kindOf)).toEqual(["compact.merge", "compact.complete"]);
    const out = p2.result;
    expect(out.l0).toEqual([]);
    expect(out.levels.length).toBe(2);
    const l1 = out.levels[0].flatMap((f) => sstableEntries(f));
    expect(l1.find((e) => e.key === "k2")?.tombstone).toBe(true); // survived
    expect(out.levels[1].flatMap((f) => sstableEntries(f)).map((e) => e.key)).toEqual(["k2"]);
    // the tombstone still shadows the older copy below
    expect(walkKey(out, "k2")).toBeNull();
    expectInvariants(out);
  });

  it("drops a tombstone when no lower level covers its key (even though one exists)", () => {
    const s = craft({
      l0: [mkSst("s1", [ent("e4", "k1", "v1", 4), ent("e5", "k2", "gone", 5, true)])],
      levels: [
        [mkSst("l1a", [ent("e2", "k2", "old", 3), ent("e3", "k3", "v3", 2)])],
        [mkSst("l2a", [ent("e1", "k9", "elsewhere", 1)])], // does NOT cover k2
      ],
      config: { l0Trigger: 1, targetFileSize: 999 },
    });
    let s1 = run("compact", {}, s).result;
    s1 = run("compact", {}, s1).result;
    const keys = s1.levels.flat().flatMap((f) => sstableEntries(f).map((e) => e.key));
    expect(keys).toEqual(["k1", "k3", "k9"]); // k2 gone from L1; L2 untouched
    expect(walkKey(s1, "k2")).toBeNull();
  });
});

describe("leveled compaction: Ln→Ln+1 pick", () => {
  it("picks the largest file of the first level over its budget and moves it one level down", () => {
    const s = craft({
      l0: [],
      levels: [
        [
          mkSst("l1a", [ent("e1", "k1", "v1", 1), ent("e2", "k2", "v2", 2)]),
          mkSst("l1b", [ent("e3", "k3", "v3", 3), ent("e4", "k4", "v4", 4)]),
        ],
      ],
      // L1 budget = targetFileSize × fanout^1 = 28B; L1 holds 56B → over target
      config: { l0Trigger: 99, targetFileSize: 14, fanout: 2 },
    });
    const r = run("compact", {}, s);
    expect(r.error).toBeUndefined();
    expect(r.steps.map(kindOf)).toEqual(["compact.pick", "compact.merge", "compact.complete"]);
    const out = r.result;
    expect(out.levels.length).toBe(2);
    expect(out.levels[0].map((f) => f.id)).toEqual(["l1b"]); // l1a (first-largest) moved down
    expect(out.levels[1].flatMap((f) => sstableEntries(f).map((e) => e.key))).toEqual([
      "k1",
      "k2",
    ]);
    expectInvariants(out);
  });

  it("merges every overlapping file of the next level into the output", () => {
    const s = craft({
      l0: [],
      levels: [
        [mkSst("l1a", [ent("e4", "k2", "v2", 4), ent("e5", "k3", "v3", 5)])],
        [
          mkSst("l2a", [ent("e1", "k1", "v1", 1), ent("e2", "k2", "old", 2)]), // overlaps l1a
          mkSst("l2b", [ent("e3", "k9", "v9", 3)]), // disjoint, stays
        ],
      ],
      config: { l0Trigger: 99, targetFileSize: 10, fanout: 2 }, // L1 budget 20B < 28B
    });
    // two inputs (l1a + overlapping l2a) → total 2 → two presses
    const p1 = run("compact", {}, s);
    expect(p1.steps.map(kindOf)).toEqual(["compact.pick", "compact.merge"]);
    const r = run("compact", {}, p1.result);
    expect(r.steps.map(kindOf)).toEqual(["compact.merge", "compact.complete"]);
    const out = r.result;
    // l1a + overlapping l2a merged into L2; l2b untouched; L1 emptied
    const l2Keys = out.levels[1].flatMap((f) => sstableEntries(f).map((e) => e.key));
    expect(l2Keys).toEqual(["k1", "k2", "k3", "k9"]);
    expect(out.levels[0]).toEqual([]);
    // highest seq wins inside the merged range: k2 → v2 (seq 4 > 2)
    expect(walkKey(out, "k2")).toBe("v2");
    expectInvariants(out);
  });
});

describe("property: random writes + leveled compactions keep every read's answer", () => {
  const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

  function driveRandom(rnd: () => number, ops: number): { state: EngineState; reference: Map<string, string> } {
    const reference = new Map<string, string>();
    let s = leveled();
    for (let i = 0; i < ops; i++) {
      if (rnd() < 0.8) {
        const key = alphabet[Math.floor(rnd() * alphabet.length)];
        const value = `v${Math.floor(rnd() * 1000)}`;
        reference.set(key, value);
        const r = run("write", { key, value }, s);
        expect(r.error).toBeUndefined();
        if (r.steps.length > 0) expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
        s = r.result;
      } else {
        const r = run("compact", {}, s);
        expect(r.error).toBeUndefined();
        if (r.steps.length > 0) expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
        s = r.result;
      }
      expectInvariants(s);
      for (const key of alphabet) {
        expect(walkKey(s, key)).toBe(reference.get(key) ?? null);
      }
    }
    return { state: s, reference };
  }

  it("seeded scripts: invariants + reference answer after every op, twice (determinism)", () => {
    const seeds = [3, 42];
    for (const seed of seeds) {
      const a = driveRandom(mulberry32(seed), 80);
      expect(a.reference.size).toBeGreaterThan(0);
      // determinism: an identical replay lands on a deep-equal state
      const b = driveRandom(mulberry32(seed), 80);
      expect(b.state).toEqual(a.state);
    }
  });

  it("fast-check: any write/compact interleaving preserves the reference answer", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            op: fc.constantFrom("write", "compact"),
            key: fc.constantFrom(...alphabet),
            value: fc.constantFrom("v1", "v2", "v3", "v4"),
          }),
          { minLength: 40, maxLength: 80 },
        ),
        (ops) => {
          const reference = new Map<string, string>();
          let s = leveled();
          for (const op of ops) {
            if (op.op === "write") {
              reference.set(op.key, op.value);
              const r = run("write", { key: op.key, value: op.value }, s);
              if (r.error) throw new Error(r.error);
              s = r.result;
            } else {
              const r = run("compact", {}, s);
              if (r.error) throw new Error(r.error);
              s = r.result;
            }
            expectInvariants(s);
            for (const key of alphabet) {
              const expected = reference.get(key) ?? null;
              if (walkKey(s, key) !== expected) {
                throw new Error(`walk mismatch for ${key}: ${walkKey(s, key)} !== ${expected}`);
              }
            }
          }
        },
      ),
      { numRuns: 30, seed: 7 },
    );
  });
});
