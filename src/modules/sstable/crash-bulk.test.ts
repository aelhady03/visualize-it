/**
 * Tests for the crash & recover and bulk write lanes (engine/crash.ts,
 * engine/bulk.ts, scenarios/crash.ts). Assert step KIND sequences and state
 * invariants — never narration wording (AGENTS.md §6.5).
 */

import { describe, it, expect } from "vitest";
import type { EngineState } from "./state";
import { init, run } from "./engine/index";
import { maxDurableSeq } from "./engine/crash";
import { generateBulkOps } from "./engine/bulk";
import { isSorted, sstableEntries } from "./lib/derive";
import { mergeRuns } from "./lib/merge";
import { crashScenarios } from "./scenarios/crash";

const kindOf = (s: { kind: string }) => s.kind;

/** Chain plain writes; returns the final state. */
function writeAll(state: EngineState, writes: Array<{ key: string; value: string }>): EngineState {
  let s = state;
  for (const w of writes) {
    s = run("write", { key: w.key, value: w.value }, s).result;
  }
  return s;
}

const SIX_WRITES = [
  { key: "apple", value: "a0" },
  { key: "banana", value: "b0" },
  { key: "cherry", value: "c0" },
  { key: "date", value: "d0" },
  { key: "elderberry", value: "e0" },
  { key: "fig", value: "f0" },
];

describe("crash & recover (engine/crash.ts)", () => {
  it("wipes memtables + jobs but keeps the WAL, then replays the segment exactly", () => {
    const before = writeAll(init(), SIX_WRITES.slice(0, 3));
    const r = run("crash", undefined, before);
    expect(r.error).toBeUndefined();
    expect(r.steps.map(kindOf)).toEqual([
      "crash.memory-wiped",
      "crash.replay-segment",
      "crash.seq-restored",
    ]);

    // the wipe step: memory gone (memtables, jobs, seq counter), disk untouched
    const wiped = r.steps[0].state;
    expect(wiped.memtables).toEqual([]);
    expect(wiped.jobs).toEqual([]);
    expect(wiped.seq).toBe(0);
    expect(wiped.wal).toEqual(before.wal);
    expect(wiped.l0).toEqual(before.l0);

    // final: one rebuilt ACTIVE memtable with exactly the unflushed data
    const s = r.result;
    expect(s.memtables).toEqual([
      { id: "mt1", state: "active", entries: before.memtables[0].entries, walSegment: "w1" },
    ]);
    expect(s.wal).toEqual(before.wal); // truncate nothing else
    expect(s.jobs).toEqual([]);
    expect(s.seq).toBe(before.seq); // restored exactly
    expect(s.metrics).toEqual(before.metrics);
  });

  it("replays with the write path's in-place replace: a twice-written key comes back once", () => {
    const before = writeAll(init(), [
      { key: "apple", value: "a0" },
      { key: "banana", value: "b0" },
      { key: "apple", value: "a1" },
    ]);
    // the memtable holds only the latest apple; the WAL holds all three records
    expect(before.memtables[0].entries.map((e) => e.key)).toEqual(["apple", "banana"]);
    expect(before.wal[0].entries.length).toBe(3);

    const s = run("crash", undefined, before).result;
    expect(s.memtables[0].entries).toEqual(before.memtables[0].entries);
    expect(s.memtables[0].entries.find((e) => e.key === "apple")?.value).toBe("a1");
    expect(isSorted(s.memtables[0].entries)).toBe(true);
    expect(s.wal).toEqual(before.wal); // replay never rewrites the log
  });

  it("replays BOTH an active and an immutable segment into their own memtables", () => {
    const before = writeAll(init(), SIX_WRITES);
    // 6th write froze mt1 (immutable, w1) and opened mt7 (active, w7) — the
    // freeze stamps new ids with the current seq, which is 7; flush job 1/2
    expect(before.memtables.map((m) => m.state)).toEqual(["active", "immutable"]);
    expect(before.memtables[0].id).toBe("mt7");
    expect(before.memtables[0].walSegment).toBe("w7");
    expect(before.jobs.length).toBe(1);

    const r = run("crash", undefined, before);
    expect(r.steps.map(kindOf)).toEqual([
      "crash.memory-wiped",
      "crash.replay-segment",
      "crash.replay-segment",
      "crash.seq-restored",
    ]);

    const s = r.result;
    expect(s.jobs).toEqual([]); // jobs were in-memory state too
    expect(s.memtables.length).toBe(2);
    const [active, immutable] = s.memtables;
    expect(active.state).toBe("active");
    expect(active.entries).toEqual([]);
    expect(active.walSegment).toBe("w7");
    expect(immutable.state).toBe("immutable");
    expect(immutable.entries).toEqual(before.memtables[1].entries);
    expect(isSorted(immutable.entries)).toBe(true);
    expect(immutable.walSegment).toBe("w1");
    expect(s.wal).toEqual(before.wal);
    expect(s.seq).toBe(before.seq);
  });

  it("restores seq from the WAL AND the SSTables, even when the WAL is empty", () => {
    // hand-built state: flushed data on disk, an empty unflushed WAL segment
    const before: EngineState = {
      ...init(),
      seq: 23,
      wal: [{ id: "w4", entries: [] }],
      memtables: [{ id: "mt4", state: "active", entries: [], walSegment: "w4" }],
      l0: [
        {
          id: "s1",
          seq: 22,
          blocks: [{ id: "b1", entries: [{ id: "e22", key: "apple", value: "a0", seq: 22 }] }],
          bloom: new Array(16).fill(0),
          bytes: 10,
        },
      ],
      jobs: [],
    };
    const r = run("crash", undefined, before);
    expect(r.steps.map(kindOf)).toEqual([
      "crash.memory-wiped",
      "crash.replay-segment",
      "crash.seq-restored",
    ]);
    expect(r.result.seq).toBe(23); // max seq 22 lives in the SSTable — the WAL held nothing
  });

  it("keeps l0 and levels untouched", () => {
    const before = writeAll(init(), [...SIX_WRITES, { key: "grape", value: "g0" }]);
    expect(before.l0.length).toBe(1); // the 7th write completed the flush
    const s = run("crash", undefined, before).result;
    expect(s.l0).toEqual(before.l0);
    expect(s.levels).toEqual(before.levels);
  });

  it("is deterministic and JSON-safe; result deep-equals the last step state", () => {
    const before = writeAll(init(), SIX_WRITES);
    const a = run("crash", undefined, before);
    const b = run("crash", undefined, before);
    expect(a).toEqual(b);
    for (const step of a.steps) {
      expect(JSON.parse(JSON.stringify(step.state))).toEqual(step.state);
    }
    expect(a.result).toEqual(a.steps[a.steps.length - 1].state);
  });

  it("maxDurableSeq covers the WAL, l0 and levels", () => {
    const before: EngineState = {
      ...init(),
      wal: [{ id: "w1", entries: [{ id: "e3", key: "c", value: "c0", seq: 3 }] }],
      memtables: [{ id: "mt1", state: "active", entries: [], walSegment: "w1" }],
      l0: [
        {
          id: "s1",
          seq: 5,
          blocks: [{ id: "b1", entries: [{ id: "e5", key: "b", value: "b0", seq: 5 }] }],
          bloom: new Array(16).fill(0),
          bytes: 1,
        },
      ],
      levels: [
        [
          {
            id: "s2",
            seq: 9,
            blocks: [{ id: "b2", entries: [{ id: "e9", key: "a", value: "a0", seq: 9 }] }],
            bloom: new Array(16).fill(0),
            bytes: 1,
          },
        ],
      ],
    };
    expect(maxDurableSeq(before)).toBe(9);
  });
});

describe("bulk write (engine/bulk.ts)", () => {
  it("runs every insert through the write path: same kinds (bulk.-prefixed), same final state", () => {
    const ops = generateBulkOps(20, 42);
    expect(ops.length).toBe(20);

    // reference: the same 20 ops typed by hand through run("write", ...)
    let manual = init();
    const expectedKinds: string[] = [];
    for (const op of ops) {
      const r = run("write", { key: op.key, value: op.value }, manual);
      manual = r.result;
      expectedKinds.push(...r.steps.map((s) => `bulk.${s.kind}`));
    }

    const bulkRun = run("write-bulk", { count: 20, seed: 42 }, init());
    expect(bulkRun.error).toBeUndefined();
    expect(bulkRun.steps.map(kindOf)).toEqual(expectedKinds);
    expect(bulkRun.steps.every((s) => s.kind.startsWith("bulk."))).toBe(true);
    expect(bulkRun.result).toEqual(manual);
    expect(bulkRun.result).toEqual(bulkRun.steps[bulkRun.steps.length - 1].state);
  });

  it("respects count and seed deterministically", () => {
    const a = run("write-bulk", { count: 20, seed: 42 }, init());
    const b = run("write-bulk", { count: 20, seed: 42 }, init());
    expect(a).toEqual(b);

    const c = run("write-bulk", { count: 20, seed: 43 }, init());
    expect(c.result).not.toEqual(a.result); // different seed → different stream

    const smaller = run("write-bulk", { count: 5, seed: 42 }, init());
    expect(smaller.result.seq).toBe(6); // 5 inserts consumed seqs 1..5
  });

  it("final state matches a reference Map (latest value per key wins)", () => {
    const state = run("write-bulk", { count: 24, seed: 1 }, init()).result;
    const reference = new Map<string, string>();
    for (const { key, value } of generateBulkOps(24, 1)) reference.set(key, value);

    const merged = mergeRuns([
      ...state.memtables.map((m) => m.entries),
      ...state.l0.map((sst) => sstableEntries(sst)),
      ...state.levels.flat().map((sst) => sstableEntries(sst)),
    ]);
    const latest = new Map(merged.map((e) => [e.key, e]));

    expect(latest.size).toBe(reference.size);
    for (const [key, value] of reference) {
      expect(latest.get(key)?.value).toBe(value);
    }
    // invariants: sorted memtables, seq strictly ahead of every entry
    for (const mt of state.memtables) expect(isSorted(mt.entries)).toBe(true);
    const live = [
      ...state.memtables.flatMap((m) => m.entries),
      ...state.l0.flatMap((sst) => sstableEntries(sst)),
    ];
    for (const e of live) expect(state.seq > e.seq).toBe(true);
    expect(state.seq).toBe(25); // 24 inserts + the init clock at 1
  });

  it("reaches freeze and flush states through the normal path", () => {
    const r = run("write-bulk", { count: 24, seed: 1 }, init());
    const kinds = new Set(r.steps.map(kindOf));
    expect(kinds.has("bulk.memtable.freeze")).toBe(true);
    expect(kinds.has("bulk.flush.complete")).toBe(true);
    expect(r.result.l0.length).toBeGreaterThan(0);
  });

  it("rejects invalid input without emitting steps", () => {
    const prev = init();
    const invalid: Array<Record<string, string | number>> = [
      {},
      { count: 0 },
      { count: -3 },
      { count: "24" },
      { count: 24 },
      { count: 24, seed: "x" },
      { count: Number.NaN, seed: 1 },
      { count: 24, seed: Number.POSITIVE_INFINITY },
    ];
    for (const input of invalid) {
      const r = run("write-bulk", input, prev);
      expect(r.steps).toEqual([]);
      expect(r.result).toEqual(prev);
      expect(r.error).toBeDefined();
    }
  });
});

describe("scenario crash-replay (scenarios/crash.ts)", () => {
  it("runs from init(): per-segment replay rebuilds the tables and the engine continues", () => {
    const scenario = crashScenarios.find((s) => s.id === "crash-replay");
    expect(scenario).toBeTruthy();
    expect(scenario!.seedState).toBeUndefined();
    expect(scenario!.ops.map((op) => op.opId)).toEqual([
      "write",
      "write",
      "write",
      "write",
      "write",
      "write",
      "crash",
      "write",
    ]);

    let state = init();
    const kinds: string[] = [];
    for (const op of scenario!.ops) {
      const r = run(op.opId, op.input, state);
      expect(r.error).toBeUndefined();
      kinds.push(...r.steps.map(kindOf));
      state = r.result;
    }

    expect(kinds).toContain("crash.memory-wiped");
    expect(kinds.filter((k) => k === "crash.replay-segment").length).toBe(2);
    expect(kinds).toContain("crash.seq-restored");

    // final: the immutable table was rebuilt with its 6 entries, and the
    // post-crash write landed in the rebuilt active table with the next seq
    expect(state.memtables.length).toBe(2);
    const immutable = state.memtables.find((m) => m.id === "mt1");
    expect(immutable?.state).toBe("immutable");
    expect(immutable?.entries.length).toBe(6);
    const active = state.memtables.find((m) => m.id === "mt7");
    expect(active?.state).toBe("active");
    expect(active?.entries.map((e) => e.key)).toEqual(["grape"]);
    expect(state.wal.find((w) => w.id === "w7")?.entries.map((e) => e.key)).toEqual(["grape"]);
    expect(state.seq).toBe(8); // restored to 7, the follow-up write took it
  });
});
