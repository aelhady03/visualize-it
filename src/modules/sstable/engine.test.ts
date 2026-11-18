import { describe, it, expect } from "vitest";
import { runConformance } from "@core/runConformance";
import { sstableModule } from "./index";
import type { EngineState, Entry } from "./state";
import { init, run } from "./engine/index";
import { advanceJobs } from "./engine/jobs";
import {
  entryBytes,
  isSorted,
  hasDuplicateKeysWithinFile,
  sstableEntries,
  sstableMinKey,
  sstableMaxKey,
} from "./lib/derive";
import { mergeRuns } from "./lib/merge";
import { maybe } from "./lib/bloom";

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

/** Chain a list of writes, returning every RunResult. */
function drive(
  initialState: EngineState,
  writes: Array<{ key: string; value: string }>,
) {
  const results = [];
  let state = initialState;
  for (const w of writes) {
    const r = run("write", { key: w.key, value: w.value }, state);
    results.push(r);
    state = r.result;
  }
  return { results, state };
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

/** All entries in a state, including WAL copies. */
function allEntries(state: EngineState): Entry[] {
  const out: Entry[] = [];
  for (const w of state.wal) out.push(...w.entries);
  for (const m of state.memtables) out.push(...m.entries);
  for (const sst of [...state.l0, ...state.levels.flat()]) out.push(...sstableEntries(sst));
  return out;
}

/** Every §8 invariant + metric-accounting invariant that must hold after any write. */
function expectInvariants(state: EngineState, reference: Map<string, string>, ingestedRef: number) {
  // memtables sorted, WAL ⊇ its memtable
  for (const mt of state.memtables) {
    expect(isSorted(mt.entries)).toBe(true);
    const segment = state.wal.find((w) => w.id === mt.walSegment);
    expect(segment).toBeTruthy();
    const segmentIds = new Set(segment!.entries.map((e) => e.id));
    for (const e of mt.entries) expect(segmentIds.has(e.id)).toBe(true);
  }
  // files: sorted, unique keys, seq = max entry seq
  for (const sst of [...state.l0, ...state.levels.flat()]) {
    expect(isSorted(sstableEntries(sst))).toBe(true);
    expect(hasDuplicateKeysWithinFile(sst)).toBe(false);
    const maxSeq = sstableEntries(sst).reduce((m, e) => Math.max(m, e.seq), 0);
    expect(sst.seq).toBe(maxSeq);
  }
  // seq is a strict logical clock: next seq > every handed-out seq
  for (const e of allEntries(state)) expect(state.seq > e.seq).toBe(true);
  // latest version of every key equals the reference Map
  const latest = readLatest(state);
  for (const [key, value] of reference) {
    expect(latest.get(key)?.value).toBe(value);
    expect(latest.get(key)?.tombstone ?? false).toBe(false);
  }
  for (const key of latest.keys()) expect(reference.has(key)).toBe(true);
  // metric accounting (lib/derive entryBytes is the estimator)
  expect(state.metrics.ingestedBytes).toBe(ingestedRef);
  const fileBytes = state.l0.reduce((s, f) => s + f.bytes, 0);
  const walBytes = state.wal.reduce((s, w) => s + w.entries.reduce((x, e) => x + entryBytes(e), 0), 0);
  expect(state.metrics.bytesWritten).toBe(fileBytes);
  expect(state.metrics.diskBytes).toBe(fileBytes + walBytes);
}

describe("init", () => {
  it("starts with one active memtable + its WAL, empty everything else", () => {
    const s = init();
    expect(s.seq).toBe(1);
    expect(s.memtables).toEqual([{ id: "mt1", state: "active", entries: [], walSegment: "w1" }]);
    expect(s.wal).toEqual([{ id: "w1", entries: [] }]);
    expect(s.l0).toEqual([]);
    expect(s.levels).toEqual([]);
    expect(s.jobs).toEqual([]);
    expect(s.config.strategy).toBe("stcs");
  });

  it("resolves config overrides and falls back on garbage", () => {
    const s = init({ strategy: "leveled", memtableCap: 2 });
    expect(s.config.strategy).toBe("leveled");
    expect(s.config.memtableCap).toBe(2);
    const bad = init({ strategy: "nonsense", memtableCap: -5, l0Trigger: 0 });
    expect(bad.config.strategy).toBe("stcs");
    expect(bad.config.memtableCap).toBe(6);
    expect(bad.config.l0Trigger).toBe(4);
  });
});

describe("write below cap", () => {
  it("emits exactly wal.append + memtable.insert, no freeze", () => {
    const r = run("write", { key: "apple", value: "a0" }, init());
    expect(r.steps.map(kindOf)).toEqual(["wal.append", "memtable.insert"]);
    expect(r.error).toBeUndefined();
    const s = r.result;
    expect(s.memtables[0].entries).toEqual([{ id: "e1", key: "apple", value: "a0", seq: 1 }]);
    expect(s.wal[0].entries).toEqual([{ id: "e1", key: "apple", value: "a0", seq: 1 }]);
    expect(s.seq).toBe(2);
    expect(s.metrics.ingestedBytes).toBe(7); // "apple" + "a0"
  });

  it("keeps the memtable sorted on repeated writes", () => {
    const { state } = drive(init(), [
      { key: "fig", value: "f0" },
      { key: "apple", value: "a0" },
      { key: "cherry", value: "c0" },
    ]);
    expect(state.memtables[0].entries.map((e) => e.key)).toEqual(["apple", "cherry", "fig"]);
  });
});

describe("blind write / in-place replace (§5.2 Update mechanical path)", () => {
  it("replaces the key in the ACTIVE memtable; the WAL keeps both records", () => {
    const { results } = drive(init(), [
      { key: "apple", value: "a0" },
      { key: "apple", value: "a1" },
    ]);
    const s = results[1].result;
    expect(s.memtables[0].entries).toEqual([{ id: "e2", key: "apple", value: "a1", seq: 2 }]);
    expect(s.wal[0].entries.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe("memtable.freeze + flush.complete (cap 6)", () => {
  const six = [
    { key: "apple", value: "a0" },
    { key: "banana", value: "b1" },
    { key: "cherry", value: "c0" },
    { key: "date", value: "d1" },
    { key: "elderberry", value: "e1" },
    { key: "fig", value: "f0" },
  ];

  it("6th write freezes: immutable + new active + new WAL + flush job at 1/2", () => {
    const { results } = drive(init(), six);
    expect(results[0].steps.map(kindOf)).toEqual(["wal.append", "memtable.insert"]);
    expect(results[4].steps.map(kindOf)).toEqual(["wal.append", "memtable.insert"]);

    const freeze = results[5];
    expect(freeze.steps.map(kindOf)).toEqual([
      "wal.append",
      "memtable.insert",
      "memtable.freeze",
      "jobs.advance",
    ]);
    const s = freeze.result;
    // one active (new, empty) + one immutable (the frozen 6)
    expect(s.memtables.length).toBe(2);
    expect(s.memtables[0].state).toBe("active");
    expect(s.memtables[0].entries.length).toBe(0);
    expect(s.memtables[1].state).toBe("immutable");
    expect(s.memtables[1].entries.length).toBe(6);
    // new WAL segment for the new memtable; the old one still holds its 6 records
    expect(s.wal.length).toBe(2);
    expect(s.wal[1].entries.length).toBe(0);
    expect(s.wal[0].entries.length).toBe(6);
    expect(s.memtables[0].walSegment).toBe(s.wal[1].id);
    expect(s.memtables[1].walSegment).toBe(s.wal[0].id);
    // flush job: 1 unit into a 2-unit job, output = merge stream so far
    expect(s.jobs.length).toBe(1);
    expect(s.jobs[0].kind).toBe("flush");
    expect(s.jobs[0].inputs).toEqual([s.memtables[1].id]);
    expect(s.jobs[0].progress).toBe(1);
    expect(s.jobs[0].total).toBe(2);
    expect(s.jobs[0].output.map((e) => e.key)).toEqual(["apple", "banana"]);
    // no SSTable yet — the immutable memtable is observable for one op
    expect(s.l0.length).toBe(0);
  });

  it("7th write completes the flush: SSTable in l0, memtable dropped, WAL truncated", () => {
    const { state: afterSix } = drive(init(), six);
    const r = run("write", { key: "grape", value: "g0" }, afterSix);
    expect(r.steps.map(kindOf)).toEqual([
      "wal.append",
      "memtable.insert",
      "jobs.advance",
      "flush.complete",
    ]);
    const s = r.result;
    expect(s.memtables.length).toBe(1);
    expect(s.memtables[0].state).toBe("active");
    expect(s.memtables[0].entries.map((e) => e.key)).toEqual(["grape"]);
    expect(s.wal.length).toBe(1); // truncated
    expect(s.wal[0].entries.map((e) => e.key)).toEqual(["grape"]);
    expect(s.jobs.length).toBe(0);

    // the SSTable
    expect(s.l0.length).toBe(1);
    const sst = s.l0[0];
    expect(sst.id).toBe("s1"); // flushed from mt1
    expect(sst.seq).toBe(6); // MAX entry seq in the file
    expect(sst.blocks.length).toBe(3);
    expect(sst.blocks.map((b) => b.entries.length)).toEqual([2, 2, 2]);
    expect(sstableEntries(sst).map((e) => e.key)).toEqual([
      "apple",
      "banana",
      "cherry",
      "date",
      "elderberry",
      "fig",
    ]);
    expect(sstableMinKey(sst)).toBe("apple");
    expect(sstableMaxKey(sst)).toBe("fig");
    // bloom: every flushed key passes, built with the 16-bit k=2 filter
    for (const e of sstableEntries(sst)) expect(maybe(sst.bloom, e.key)).toBe(true);
    expect(sst.bloom.length).toBe(16);
    // bytes: the documented estimator over its 6 entries
    expect(sst.bytes).toBe(sstableEntries(sst).reduce((sum, e) => sum + entryBytes(e), 0));
    // metrics: flush output counted once
    expect(s.metrics.bytesWritten).toBe(sst.bytes);
    expect(s.metrics.diskBytes).toBe(sst.bytes + entryBytes({ id: "e7", key: "grape", value: "g0", seq: 7 }));
  });
});

describe("seq monotonicity, determinism, JSON-safety", () => {
  const script = [
    { key: "a", value: "1" },
    { key: "b", value: "2" },
    { key: "a", value: "3" },
    { key: "c", value: "4" },
    { key: "d", value: "5" },
    { key: "e", value: "6" },
    { key: "f", value: "7" },
    { key: "g", value: "8" },
  ];

  it("same inputs twice give deep-equal steps and results", () => {
    const a = drive(init(), script);
    const b = drive(init(), script);
    expect(a.results).toEqual(b.results);
    expect(a.state).toEqual(b.state);
  });

  it("every step snapshot survives a JSON round-trip and result deep-equals the last step", () => {
    const { results } = drive(init(), script);
    for (const r of results) {
      for (const step of r.steps) {
        expect(JSON.parse(JSON.stringify(step.state))).toEqual(step.state);
      }
      if (r.steps.length > 0) expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
    }
  });

  it("seq strictly increases and entry seqs are unique", () => {
    const { state } = drive(init(), script);
    // live containers (memtables + files): each entry once
    const live = [
      ...state.memtables.flatMap((m) => m.entries),
      ...state.l0.flatMap((s) => sstableEntries(s)),
    ];
    const seqs = live.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // unique among live containers
    for (const s of seqs) expect(s).toBeLessThan(state.seq);
    // WAL ⊇ memtable: every memtable entry appears in its segment (the WAL
    // may also hold extra records for keys replaced in memory before flush)
    for (const m of state.memtables) {
      const segIds = new Set(
        state.wal.find((w) => w.id === m.walSegment)?.entries.map((e) => e.id) ?? [],
      );
      for (const e of m.entries) expect(segIds.has(e.id)).toBe(true);
    }
    expect(state.wal[0].entries.length).toBe(1); // only the last write survives the truncation
    expect(state.seq).toBe(9); // 8 writes consumed 8 seqs
    // the replaced first version of "a" lived only in w1, which was truncated
    // at flush — the old version never reached disk (documented §5.2 Update)
    expect(seqs).not.toContain(1);
  });
});

describe("compact.trigger", () => {
  it("fires as the final step once l0 reaches l0Trigger (4), creating no job", () => {
    // cap 6 → flushes complete on writes 7, 13, 19, 25
    const writes = Array.from({ length: 25 }, (_, i) => ({
      key: `key-${String(i).padStart(2, "0")}`,
      value: `v${i}`,
    }));
    const { results } = drive(init(), writes);
    // no trigger before the 4th flush lands
    expect(results[24].steps.map(kindOf)).toEqual([
      "wal.append",
      "memtable.insert",
      "jobs.advance",
      "flush.complete",
      "compact.trigger",
    ]);
    const s = results[24].result;
    expect(s.l0.length).toBe(4);
    expect(s.jobs.length).toBe(0); // trigger narrates only; Phase 6 creates the job

    // and it keeps firing while the threshold is met
    const next = run("write", { key: "extra", value: "x" }, s);
    expect(next.steps.map(kindOf)).toEqual(["wal.append", "memtable.insert", "compact.trigger"]);
    expect(next.result.l0.length).toBe(4);
  });
});

describe("invalid input and unknown ops", () => {
  it("rejects an empty key without emitting steps", () => {
    const prev = init();
    const r = run("write", { key: "", value: "x" }, prev);
    expect(r.steps).toEqual([]);
    expect(r.result).toEqual(prev);
    expect(r.error).toBeDefined();
    expect(run("write", {}, prev).steps).toEqual([]);
    expect(run("write", undefined, prev).steps).toEqual([]);
  });

  it("routes every declared op to its stub runner until its lane implements it", () => {
    for (const op of ["read", "update", "delete", "compact", "crash", "write-bulk"]) {
      const r = run(op, {}, init());
      expect(r.steps).toEqual([]);
      expect(r.result).toEqual(init());
      expect(r.error).toBe("not implemented");
    }
  });

  it("reports not-implemented for an unknown op id", () => {
    const prev = init();
    const r = run("bogus", {}, prev);
    expect(r.steps).toEqual([]);
    expect(r.result).toEqual(prev);
    expect(r.error).toBe("not implemented yet");
  });
});

describe("contract conformance (PLAN.md §3.5)", () => {
  it("passes runConformance with the skeleton (empty scenarios, stub ops)", async () => {
    const report = await runConformance(sstableModule);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

describe("advanceJobs (jobs.ts)", () => {
  it("completes a flush job directly when called on a pending state", () => {
    const six = ["apple", "banana", "cherry", "date", "elderberry", "fig"].map((k, i) => ({
      key: k,
      value: `v${i}`,
    }));
    const { state: frozen } = drive(init(), six); // job at progress 1
    const done = advanceJobs(frozen);
    expect(done.jobs.length).toBe(0);
    expect(done.l0.length).toBe(1);
    expect(done.memtables.length).toBe(1);
    expect(done.wal.length).toBe(1);
    expect(done.metrics.bytesWritten).toBe(done.l0[0].bytes);
  });
});

describe("property: random write sequences match a reference Map", () => {
  const seeds = [7, 99];
  const strategies = ["stcs", "leveled"] as const;

  for (const seed of seeds) {
    it(`seed ${seed}: invariants hold after every prefix, under both strategies`, () => {
      const rnd = mulberry32(seed);
      const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((c) => `k${c}`);
      const ops = Array.from({ length: 40 }, () => ({
        key: alphabet[Math.floor(rnd() * alphabet.length)],
        value: `v${Math.floor(rnd() * 1000)}`,
      }));

      let stcsState: EngineState | null = null;
      for (const strategy of strategies) {
        // same op list per strategy → identical reference maps
        const reference = new Map<string, string>();
        let ingestedRef = 0;
        let state = init({ strategy });
        for (const op of ops) {
          reference.set(op.key, op.value);
          ingestedRef += op.key.length + op.value.length;
          const r = run("write", { key: op.key, value: op.value }, state);
          expect(r.error).toBeUndefined();
          expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
          state = r.result;
          expectInvariants(state, reference, ingestedRef);
        }
        if (strategy === "stcs") {
          stcsState = state;
        } else {
          // identical except the resolved config.strategy — normalize it
          const normalize = (s: EngineState) => ({
            ...s,
            config: { ...s.config, strategy: "stcs" as const },
          });
          expect(normalize(state)).toEqual(normalize(stcsState!)); // levels stay empty: strategies agree
        }
      }
    });
  }
});
