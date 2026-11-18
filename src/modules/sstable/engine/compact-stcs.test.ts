/**
 * Tests for the STCS compaction lane (engine/compact-stcs.ts, PLAN.md §5.2
 * Compact — size-tiered). Asserts step KIND sequences and state invariants,
 * never narration wording (PLAN.md §8).
 */

import { describe, it, expect } from "vitest";
import type { EngineState, Entry, SSTable } from "../state";
import { init, run } from "./index";
import {
  runCompactStcs,
  groupStcsBuckets,
  pickStcsBucket,
  stcsMergePlan,
  compactionOutputId,
  STCS_SIZE_RATIO,
} from "./compact-stcs";
import { buildSSTable } from "./jobs";
import {
  entryBytes,
  isSorted,
  hasDuplicateKeysWithinFile,
  sstableEntries,
} from "../lib/derive";
import { mergeRuns } from "../lib/merge";

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

const kindOf = (s: { kind: string }) => s.kind;

function entry(id: string, key: string, value: string, seq: number, tombstone = false): Entry {
  return tombstone ? { id, key, value, seq, tombstone: true } : { id, key, value, seq };
}

/** A hand-built SSTable with a chosen byte size (grouping reads only id/bytes). */
function file(id: string, bytes: number, seq = 0): SSTable {
  return { id, seq, blocks: [], bloom: new Array(16).fill(0), bytes };
}

/** Chain ops, returning every RunResult. */
function drive(
  initialState: EngineState,
  ops: Array<{ opId: string; input?: Record<string, string | number | boolean> }>,
) {
  const results = [];
  let state = initialState;
  for (const op of ops) {
    const r = run(op.opId, op.input, state);
    results.push(r);
    state = r.result;
  }
  return { results, state };
}

/** The 13 writes that leave cap-3 states with L0 = [s1, s4, s7, s10] and no jobs. */
const CAP3_WRITES = [
  { key: "k1", value: "v1" },
  { key: "k2", value: "v2" },
  { key: "k3", value: "v3" },
  { key: "k4", value: "v4" },
  { key: "k5", value: "v5" },
  { key: "k6", value: "v6" },
  { key: "k1", value: "v7" }, // update across files → stale v1 drops in the merge
  { key: "k7", value: "v8" },
  { key: "k8", value: "v9" },
  { key: "k9", value: "v10" },
  { key: "k2", value: "v11" }, // update across files → stale v2 drops in the merge
  { key: "k10", value: "v12" },
  { key: "k11", value: "v13" },
];

function seedState(): EngineState {
  return init({ memtableCap: 3 });
}

/** Latest version of every key, reconciled from memtables + l0 (max seq wins). */
function readLatest(state: EngineState): Map<string, Entry> {
  const runs: Entry[][] = [
    ...state.memtables.map((m) => m.entries),
    ...state.l0.map((sst) => sstableEntries(sst)),
  ];
  const merged = mergeRuns(runs);
  return new Map(merged.map((e) => [e.key, e]));
}

// ---------------------------------------------------------------------------
// Bucket grouping
// ---------------------------------------------------------------------------

describe("groupStcsBuckets: similar-size buckets (ratio ~2x)", () => {
  it("groups files whose sizes stay within 2x of the bucket's smallest", () => {
    const buckets = groupStcsBuckets([
      file("s1", 100),
      file("s2", 250),
      file("s3", 110),
      file("s4", 300),
      file("s5", 120),
    ]);
    expect(buckets.map((b) => b.map((f) => f.id))).toEqual([
      ["s1", "s3", "s5"], // 100..120, all < 200
      ["s2", "s4"], // 250, 300 < 500
    ]);
  });

  it("splits exactly at the 2x boundary (>= ratio starts a new bucket)", () => {
    const buckets = groupStcsBuckets([file("s1", 100), file("s2", 200), file("s3", 399), file("s4", 400)]);
    expect(buckets.map((b) => b.map((f) => f.id))).toEqual([
      ["s1"],
      ["s2", "s3"], // 399 < 200 * 2
      ["s4"], // 400 >= 200 * 2
    ]);
  });

  it("is deterministic and independent of the input array order", () => {
    const files = [file("s1", 100), file("s2", 110), file("s3", 250), file("s4", 300)];
    const forward = groupStcsBuckets(files);
    const reversed = groupStcsBuckets([...files].reverse());
    expect(forward).toEqual(reversed);
  });

  it("uses the teaching ratio 2 by default", () => {
    expect(STCS_SIZE_RATIO).toBe(2);
    const custom = groupStcsBuckets([file("s1", 100), file("s2", 190)], 1.5);
    expect(custom.length).toBe(2); // 190 >= 100 * 1.5
  });
});

describe("pickStcsBucket: the bucket to merge next", () => {
  it("returns null when no bucket reaches the threshold", () => {
    expect(pickStcsBucket([file("s1", 100), file("s2", 110), file("s3", 120)], 4)).toBeNull();
  });

  it("picks the qualifying bucket with the most files", () => {
    const small = [file("s1", 100), file("s2", 110), file("s3", 120), file("s4", 130)];
    const big = [file("s5", 300), file("s6", 310), file("s7", 320), file("s8", 330), file("s9", 340)];
    const picked = pickStcsBucket([...big, ...small], 4)!;
    expect(picked.map((f) => f.id)).toEqual(big.map((f) => f.id));
  });

  it("breaks a count tie toward the larger total bytes", () => {
    const small = [file("s1", 100), file("s2", 110), file("s3", 120), file("s4", 130)];
    const large = [file("s5", 300), file("s6", 310), file("s7", 320), file("s8", 330)];
    const picked = pickStcsBucket([...small, ...large], 4)!;
    expect(picked.map((f) => f.id)).toEqual(large.map((f) => f.id));
  });
});

// ---------------------------------------------------------------------------
// Merge correctness: highest seq wins (the R1 counter-example, PLAN.md §5.2 Read)
// ---------------------------------------------------------------------------

describe("stcsMergePlan: highest seq wins (R1 counter-example)", () => {
  const runA = buildSSTable("sA", [entry("a1", "x", "v1", 1)], 2);
  const runB = buildSSTable("sB", [entry("b1", "x", "v2", 3)], 2);
  const runC = buildSSTable("sC", [entry("c1", "y", "big", 9)], 2); // no x, maxSeq 9 > 3

  it("keeps x=v2@3 even though another input has a higher max seq", () => {
    const plan = stcsMergePlan([runA, runB, runC], []);
    expect(plan.output.map((e) => [e.key, e.value, e.seq])).toEqual([
      ["x", "v2", 3],
      ["y", "big", 9],
    ]);
    expect(plan.dropped).toEqual([entry("a1", "x", "v1", 1)]); // the stale x version
  });

  it("is independent of input file order", () => {
    const forward = stcsMergePlan([runA, runB, runC], []);
    const reversed = stcsMergePlan([runC, runB, runA], []);
    expect(reversed.output).toEqual(forward.output);
  });
});

// ---------------------------------------------------------------------------
// The STCS tombstone GC rule (§5.2 Delete): kept vs dropped, both ways
// ---------------------------------------------------------------------------

describe("stcsGcPolicy: tombstone kept vs dropped", () => {
  const inA = buildSSTable("sInA", [entry("a1", "x", "v1", 1)], 2); // seq 1
  const inB = buildSSTable(
    "sInB",
    [entry("b1", "x", "", 3, true), entry("b2", "y", "v2", 4)],
    2,
  ); // seq 4; tombstone for x @3
  const olderOutside = buildSSTable("sOld", [entry("o1", "x", "v0", 2)], 2); // seq 2 < 3
  const newerOutside = buildSSTable("sNew", [entry("n1", "x", "v9", 9)], 2); // seq 9 > 3
  const olderWithoutKey = buildSSTable("sOther", [entry("o2", "z", "w", 2)], 2); // seq 2, no x

  it("KEEPS the tombstone when an OLDER file outside the merge can hold the key", () => {
    const plan = stcsMergePlan([inA, inB], [olderOutside]);
    expect(plan.output.map((e) => [e.key, e.seq, e.tombstone ?? false])).toEqual([
      ["x", 3, true], // the tombstone survives: an older x can exist outside
      ["y", 4, false],
    ]);
    expect(plan.dropped).toEqual([entry("a1", "x", "v1", 1)]);
  });

  it("DROPS the tombstone (whole key) when no older file outside exists", () => {
    const plan = stcsMergePlan([inA, inB], []);
    expect(plan.output.map((e) => e.key)).toEqual(["y"]); // x vanishes entirely
    expect(plan.dropped.map((e) => e.id)).toEqual(["a1", "b1"]);
  });

  it("a NEWER file holding the key does NOT block the drop", () => {
    const plan = stcsMergePlan([inA, inB], [newerOutside]);
    expect(plan.output.map((e) => e.key)).toEqual(["y"]);
  });

  it("an older file that cannot hold the key (range miss) does not block the drop", () => {
    const plan = stcsMergePlan([inA, inB], [olderWithoutKey]);
    expect(plan.output.map((e) => e.key)).toEqual(["y"]);
  });

  it("the policy only gates tombstones — live winners are never consulted", () => {
    // Live value @3 beats tombstone @2 inside the inputs; the policy must not matter.
    const liveWins = buildSSTable(
      "sA",
      [entry("a1", "x", "", 2, true), entry("a2", "w", "v", 5)],
      2,
    );
    const newer = buildSSTable("sB", [entry("b1", "x", "v3", 3)], 2);
    const plan = stcsMergePlan([liveWins, newer], [olderOutside]);
    const x = plan.output.find((e) => e.key === "x");
    expect(x?.value).toBe("v3"); // highest seq wins; tombstone is just stale
    expect(x?.tombstone ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The compact operation: kind sequences end to end
// ---------------------------------------------------------------------------

describe("runCompactStcs: step kind sequences (cap 3)", () => {
  it("13 writes land 4 similar-size files; compacts run start → stall → advance ×3 → complete", () => {
    const { results, state } = drive(seedState(), [
      ...CAP3_WRITES.map((w) => ({ opId: "write", input: w })),
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
    ]);
    const kinds = results.map((r) => r.steps.map(kindOf));
    const write13 = results[12];
    expect(write13.steps.map(kindOf)).toEqual([
      "wal.append",
      "memtable.insert",
      "jobs.advance",
      "flush.complete",
      "compact.trigger", // lead-owned write path narrates the threshold
    ]);
    expect(kinds[13]).toEqual(["compact.start", "compact.stall"]);
    expect(kinds[14]).toEqual(["compact.advance", "compact.stall"]);
    expect(kinds[15]).toEqual(["compact.advance", "compact.stall"]);
    expect(kinds[16]).toEqual(["compact.advance", "compact.stall"]);
    expect(kinds[17]).toEqual(["compact.advance", "compact.complete"]);

    const before = results[12].result;
    expect(before.l0.map((f) => f.id)).toEqual(["s1", "s4", "s7", "s10"]);

    const after = state;
    expect(after.l0.map((f) => f.id)).toEqual(["s14"]);
    expect(after.jobs).toEqual([]);
    // 10 surviving keys (k1..k10; k11 is still in the memtable above L0)
    const merged = sstableEntries(after.l0[0]);
    expect(merged.map((e) => e.key)).toEqual([
      "k1",
      "k10",
      "k2",
      "k3",
      "k4",
      "k5",
      "k6",
      "k7",
      "k8",
      "k9",
    ]);
    // highest seq wins for the updated keys; stale versions dropped
    expect(merged.find((e) => e.key === "k1")?.value).toBe("v7");
    expect(merged.find((e) => e.key === "k2")?.value).toBe("v11");
  });

  it("the merge stream grows with progress and equals the full merge at completion", () => {
    const { results, state } = drive(seedState(), [
      ...CAP3_WRITES.map((w) => ({ opId: "write", input: w })),
      { opId: "compact" }, // job at 0/4
      { opId: "compact" }, // 1/4
      { opId: "compact" }, // 2/4
      { opId: "compact" }, // 3/4
      { opId: "compact" }, // 4/4 → complete
    ]);
    const jobAt = (i: number) => results[i].result.jobs.find((j) => j.kind === "compaction")!;
    expect(jobAt(13).output).toEqual([]);
    expect(jobAt(14).output.length).toBe(3); // ceil(10 * 1 / 4)
    expect(jobAt(15).output.length).toBe(5); // ceil(10 * 2 / 4)
    expect(jobAt(16).output.length).toBe(8); // ceil(10 * 3 / 4)
    const merged = sstableEntries(state.l0[0]);
    expect(jobAt(16).output).toEqual(merged.slice(0, 8)); // the stream is a prefix of the final file
  });

  it("emits only compact.none on a fresh state (no bucket, no jobs)", () => {
    const s = init();
    const r = run("compact", {}, s);
    expect(r.steps.map(kindOf)).toEqual(["compact.none"]);
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual(s);
  });

  it("emits compact.none when files exist but no bucket reaches the threshold", () => {
    const { state } = drive(seedState(), CAP3_WRITES.slice(0, 7).map((w) => ({ opId: "write", input: w })));
    expect(state.l0.length).toBe(2); // s1, s4 — below stcsMinThreshold 4
    const r = run("compact", {}, state);
    expect(r.steps.map(kindOf)).toEqual(["compact.none"]);
    expect(r.result.l0).toEqual(state.l0);
  });

  it("cascades a finishing flush into the trigger: advance → flush-complete → start → stall", () => {
    // After 12 writes: L0 = [s1, s4, s7] and a flush job is in flight (1/2).
    const { state } = drive(seedState(), CAP3_WRITES.slice(0, 12).map((w) => ({ opId: "write", input: w })));
    expect(state.jobs.length).toBe(1);
    const r = run("compact", {}, state);
    expect(r.steps.map(kindOf)).toEqual([
      "compact.advance",
      "compact.flush-complete",
      "compact.start",
      "compact.stall",
    ]);
    expect(r.result.l0.map((f) => f.id)).toEqual(["s1", "s4", "s7", "s10"]);
    expect(r.result.jobs.map((j) => j.kind)).toEqual(["compaction"]);
    // The flush job stamp (j13) was taken by the just-finished flush — the
    // new job must not reuse it.
    expect(r.result.jobs[0].id).toBe("j14");
  });

  it("a write advances a compaction job but only a compact op completes it (write.ts seam)", () => {
    const { state: started } = drive(seedState(), [
      ...CAP3_WRITES.map((w) => ({ opId: "write", input: w })),
      { opId: "compact" }, // job j14 at 0/4
    ]);
    const jobId = started.jobs[0].id;
    expect(started.jobs[0].progress).toBe(0);
    const w = run("write", { key: "k12", value: "v14" }, started);
    const job = w.result.jobs.find((j) => j.id === jobId)!;
    expect(job.progress).toBe(1); // advanced by the write
    expect(w.result.jobs).toHaveLength(1); // not completed — write.ts only completes flush jobs
    // the next compact completes it (progress >= total = 4 from earlier advances)
    const c1 = run("compact", {}, w.result);
    const c2 = run("compact", {}, c1.result);
    const c3 = run("compact", {}, c2.result);
    expect(c3.steps.map(kindOf)).toEqual(["compact.advance", "compact.complete"]);
  });

  it("no stall step once the merge lands and L0 drops below l0Trigger", () => {
    const { results } = drive(seedState(), [
      ...CAP3_WRITES.map((w) => ({ opId: "write", input: w })),
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
    ]);
    const final = results[17];
    expect(final.steps.map(kindOf)).toEqual(["compact.advance", "compact.complete"]);
    expect(final.result.l0.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Metrics (§5.1: bytesWritten = flushed + compaction outputs; diskBytes = live disk)
// ---------------------------------------------------------------------------

describe("runCompactStcs: metrics accounting", () => {
  it("tracks bytesWritten and diskBytes through the merge", () => {
    const { results, state } = drive(seedState(), [
      ...CAP3_WRITES.map((w) => ({ opId: "write", input: w })),
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
    ]);
    const before = results[12].result;
    const inputs = before.l0;
    const inputBytes = inputs.reduce((sum, f) => sum + f.bytes, 0);
    const walBytes = before.wal.reduce(
      (sum, w) => sum + w.entries.reduce((x, e) => x + entryBytes(e), 0),
      0,
    );
    expect(before.metrics.bytesWritten).toBe(inputBytes); // 4 flushes
    expect(before.metrics.diskBytes).toBe(inputBytes + walBytes);

    const after = state;
    const outputBytes = after.l0[0].bytes;
    expect(after.l0).toHaveLength(1);
    // write amplification: the merge output is written on top of the flushes
    expect(after.metrics.bytesWritten).toBe(inputBytes + outputBytes);
    // disk: the 4 inputs were consumed, the merged file took their place
    expect(after.metrics.diskBytes).toBe(outputBytes + walBytes);
    expect(after.metrics.ingestedBytes).toBe(before.metrics.ingestedBytes); // compaction ingests nothing
  });

  it("a merge that drops everything consumes the inputs without writing a file", () => {
    // Hand-built state: a bucket of 4 similar-size files whose keys are all
    // tombstoned by the merge (no older file outside) → the merge output is
    // empty, so the inputs are consumed and nothing is written back.
    const tombX = buildSSTable("sA", [entry("a1", "x", "", 4, true)], 2); // seq 4
    const oldX = buildSSTable("sB", [entry("b1", "x", "v1", 1)], 2); // seq 1
    const tombY = buildSSTable("sC", [entry("c1", "y", "", 5, true)], 2); // seq 5
    const oldY = buildSSTable("sD", [entry("d1", "y", "v2", 2)], 2); // seq 2
    const files = [tombX, oldX, tombY, oldY];
    const disk = files.reduce((sum, f) => sum + f.bytes, 0);
    const state: EngineState = {
      seq: 10,
      wal: [],
      memtables: [],
      l0: files,
      levels: [],
      jobs: [],
      config: init().config,
      metrics: { ingestedBytes: 0, bytesWritten: disk, diskBytes: disk, lastReadFiles: 0, lastReadBlocks: 0 },
    };
    const start = runCompactStcs(state, undefined);
    expect(start.steps.map(kindOf)).toEqual(["compact.start", "compact.stall"]);
    let s = start.result;
    for (let i = 0; i < 4; i++) {
      const r = runCompactStcs(s, undefined);
      s = r.result;
      if (i < 3) expect(s.jobs.some((j) => j.kind === "compaction")).toBe(true);
    }
    expect(s.jobs).toEqual([]);
    expect(s.l0).toEqual([]); // all four inputs consumed, nothing written back
    expect(s.metrics.bytesWritten).toBe(disk); // no output bytes
    expect(s.metrics.diskBytes).toBe(0); // 300 → inputs gone
  });
});

// ---------------------------------------------------------------------------
// Determinism + JSON safety + invariants for the compact op itself
// ---------------------------------------------------------------------------

describe("runCompactStcs: determinism and JSON-safety", () => {
  const script = [
    ...CAP3_WRITES.map((w) => ({ opId: "write", input: w })),
    { opId: "compact" },
    { opId: "compact" },
    { opId: "compact" },
    { opId: "compact" },
    { opId: "compact" },
  ];

  it("same script twice gives deep-equal results", () => {
    const a = drive(seedState(), script);
    const b = drive(seedState(), script);
    expect(a.results).toEqual(b.results);
    expect(a.state).toEqual(b.state);
  });

  it("every step snapshot survives a JSON round-trip and result deep-equals the last step", () => {
    const { results } = drive(seedState(), script);
    for (const r of results) {
      for (const step of r.steps) {
        expect(JSON.parse(JSON.stringify(step.state))).toEqual(step.state);
      }
      expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
    }
  });

  it("jobs/outputs stay valid: job ids and output file ids are unique and stable", () => {
    const { results } = drive(seedState(), script);
    const job = results[13].result.jobs[0];
    expect(job.kind).toBe("compaction");
    expect(job.inputs).toEqual(["s1", "s4", "s7", "s10"]);
    expect(job.total).toBe(4);
    expect(compactionOutputId(job)).toBe("s14");
    // every entity id across the final state is unique
    const ids: string[] = [
      ...results[17].result.l0.map((f) => f.id),
      ...results[17].result.memtables.map((m) => m.id),
      ...results[17].result.wal.map((w) => w.id),
      ...results[17].result.jobs.map((j) => j.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Property test: random writes + STCS compactions match a reference Map
// ---------------------------------------------------------------------------

describe("property: random writes + stcs compactions match a reference Map", () => {
  const seeds = [3, 21, 77];

  for (const seed of seeds) {
    it(`seed ${seed}: invariants hold after every op`, () => {
      const rnd = mulberry32(seed);
      const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h"].map((c) => `k${c}`);
      const ops = Array.from({ length: 60 }, () => {
        if (rnd() < 0.75) {
          return {
            opId: "write" as const,
            input: { key: alphabet[Math.floor(rnd() * alphabet.length)], value: `v${Math.floor(rnd() * 1000)}` },
          };
        }
        return { opId: "compact" as const };
      });

      const reference = new Map<string, string>();
      let ingestedRef = 0;
      let bytesWrittenRef = 0;
      let prevFileIds = new Set<string>();
      let state = init({ strategy: "stcs" });

      for (const op of ops) {
        if (op.opId === "write") {
          reference.set(String(op.input.key), String(op.input.value));
          ingestedRef += String(op.input.key).length + String(op.input.value).length;
        }
        const r = run(op.opId, op.input, state);
        expect(r.error).toBeUndefined();
        expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
        state = r.result;

        // every new L0 file that appeared this op was written (flush or merge)
        const newFiles = state.l0.filter((f) => !prevFileIds.has(f.id));
        for (const f of newFiles) bytesWrittenRef += f.bytes;
        prevFileIds = new Set(state.l0.map((f) => f.id));

        // §8 invariants
        for (const mt of state.memtables) {
          expect(isSorted(mt.entries)).toBe(true);
          const segment = state.wal.find((w) => w.id === mt.walSegment);
          expect(segment).toBeTruthy();
          const segmentIds = new Set(segment!.entries.map((e) => e.id));
          for (const e of mt.entries) expect(segmentIds.has(e.id)).toBe(true);
        }
        for (const sst of state.l0) {
          expect(isSorted(sstableEntries(sst))).toBe(true);
          expect(hasDuplicateKeysWithinFile(sst)).toBe(false);
          const maxSeq = sstableEntries(sst).reduce((m, e) => Math.max(m, e.seq), 0);
          expect(sst.seq).toBe(maxSeq);
        }
        const allSeq = [
          ...state.memtables.flatMap((m) => m.entries),
          ...state.l0.flatMap((s) => sstableEntries(s)),
        ].map((e) => e.seq);
        for (const seq of allSeq) expect(state.seq > seq).toBe(true);

        // every key's newest value matches the reference Map
        const latest = readLatest(state);
        for (const [key, value] of reference) expect(latest.get(key)?.value).toBe(value);
        for (const key of latest.keys()) expect(reference.has(key)).toBe(true);

        // metric accounting
        expect(state.metrics.ingestedBytes).toBe(ingestedRef);
        expect(state.metrics.bytesWritten).toBe(bytesWrittenRef);
        const fileBytes = state.l0.reduce((s, f) => s + f.bytes, 0);
        const walBytes = state.wal.reduce(
          (s, w) => s + w.entries.reduce((x, e) => x + entryBytes(e), 0),
          0,
        );
        expect(state.metrics.diskBytes).toBe(fileBytes + walBytes);
      }
    });
  }
});
