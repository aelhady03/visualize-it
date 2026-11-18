import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState, Entry, MemTable, Metrics, SSTable, WalSegment } from "../state";
import { maybe } from "../lib/bloom";
import { sstableEntries } from "../lib/derive";
import { init, run } from "./index";
import { buildSSTable } from "./jobs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ent(id: string, key: string, value: string, seq: number, tombstone?: boolean): Entry {
  return tombstone === true ? { id, key, value, seq, tombstone: true } : { id, key, value, seq };
}

/** A hand-built engine state: one empty active MemTable unless overridden. */
function stateWith(opts: {
  strategy?: "stcs" | "leveled";
  l0?: SSTable[];
  levels?: SSTable[][];
  memtables?: MemTable[];
  wal?: WalSegment[];
  seq?: number;
  metrics?: Partial<Metrics>;
}): EngineState {
  const base = init({ strategy: opts.strategy ?? "stcs" });
  return {
    ...base,
    seq: opts.seq ?? base.seq,
    wal: opts.wal ?? base.wal,
    memtables: opts.memtables ?? base.memtables,
    l0: opts.l0 ?? [],
    levels: opts.levels ?? [],
    metrics: { ...base.metrics, ...opts.metrics },
  };
}

const SIX_KEYS = ["apple", "banana", "cherry", "date", "elderberry", "fig"];

/** One SSTable over the six demo keys, seqs startSeq..startSeq+5. */
function sixFile(id: string, startSeq = 1): SSTable {
  return buildSSTable(
    id,
    SIX_KEYS.map((key, i) => ent(`e${startSeq + i}`, key, `v${i}`, startSeq + i)),
    2,
  );
}

const kindsOf = (r: { steps: Array<{ kind: string }> }): string[] => r.steps.map((s) => s.kind);

/** The machine-readable outcome the read op puts on its final step. */
function readExtras(r: RunResult<EngineState>): Record<string, unknown> {
  const last = r.steps[r.steps.length - 1];
  return (last.extras ?? {}) as Record<string, unknown>;
}

/** Everything except metrics — reads must not touch anything else. */
function withoutMetrics(x: EngineState): Omit<EngineState, "metrics"> {
  return {
    seq: x.seq,
    wal: x.wal,
    memtables: x.memtables,
    l0: x.l0,
    levels: x.levels,
    jobs: x.jobs,
    config: x.config,
  };
}

function drive(
  ops: ReadonlyArray<readonly [string, OpInput]>,
  initial: EngineState = init(),
): { results: RunResult<EngineState>[]; state: EngineState } {
  const results: RunResult<EngineState>[] = [];
  let state = initial;
  for (const [opId, input] of ops) {
    const r = run(opId, input, state);
    results.push(r);
    state = r.result;
  }
  return { results, state };
}

// ---------------------------------------------------------------------------
// Invalid input
// ---------------------------------------------------------------------------

describe("invalid input", () => {
  it("rejects a missing, empty or non-string key without emitting steps", () => {
    const prev = init();
    const inputs: Array<OpInput | undefined> = [undefined, {}, { key: "" }, { key: 42 }];
    for (const input of inputs) {
      const r = run("read", input, prev);
      expect(r.steps).toEqual([]);
      expect(r.result).toBe(prev);
      expect(r.error).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Memtable probes
// ---------------------------------------------------------------------------

describe("memtable probes", () => {
  it("hits the active MemTable and stops there", () => {
    let s = init();
    for (const [k, v] of [
      ["apple", "red"],
      ["kiwi", "green"],
      ["plum", "purple"],
    ] as const) {
      s = run("write", { key: k, value: v }, s).result;
    }
    const r = run("read", { key: "plum" }, s);
    expect(r.error).toBeUndefined();
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.done"]);
    expect(readExtras(r)).toMatchObject({
      key: "plum",
      found: true,
      value: "purple",
      seq: 3,
      filesProbed: 0,
      blocksProbed: 0,
    });
    expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
    expect(r.result.metrics.lastReadFiles).toBe(0);
    expect(r.result.metrics.lastReadBlocks).toBe(0);
  });

  it("reports not found through a normal walk on an empty tree", () => {
    const r = run("read", { key: "mango" }, init());
    expect(r.error).toBeUndefined();
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.done"]);
    expect(readExtras(r)).toMatchObject({
      key: "mango",
      found: false,
      tombstone: false,
      filesProbed: 0,
      blocksProbed: 0,
    });
  });

  it("probes immutable MemTables newest-first; a hit there is final", () => {
    let s = init();
    for (const [i, key] of SIX_KEYS.entries()) {
      s = run("write", { key, value: `v${i}` }, s).result;
    }
    // one active (empty) + one immutable (the six); flush job at 1/2
    const r = run("read", { key: "cherry" }, s);
    expect(kindsOf(r)).toEqual([
      "read.memtable-active",
      "read.memtable-immutable",
      "read.done",
    ]);
    expect(readExtras(r)).toMatchObject({ found: true, value: "v2", seq: 3 });
    expect(r.result.jobs[0].progress).toBe(1); // reads do not advance jobs
  });
});

// ---------------------------------------------------------------------------
// File probes
// ---------------------------------------------------------------------------

describe("file probes (stcs)", () => {
  it("range miss: the file is never opened", () => {
    const r = run("read", { key: "zebra" }, stateWith({ l0: [sixFile("s1")] }));
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.done"]);
    expect(readExtras(r)).toMatchObject({ found: false, filesProbed: 0, blocksProbed: 0 });
  });

  it("bloom 'definitely not' skips the file without a block scan", () => {
    const file = buildSSTable(
      "sN",
      [ent("e1", "apple", "a", 1), ent("e2", "banana", "b", 2)],
      2,
    );
    expect(maybe(file.bloom, "apricot")).toBe(false); // premise, deterministic
    const r = run("read", { key: "apricot" }, stateWith({ l0: [file] }));
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.l0", "read.done"]);
    expect(readExtras(r)).toMatchObject({ found: false, filesProbed: 1, blocksProbed: 0 });
    expect(r.steps[1].highlights).toContainEqual({ id: "sN", role: "miss" });
  });

  it("false positive: bloom 'maybe' + scan finds nothing → keep probing, not found", () => {
    const r = run("read", { key: "blueberry" }, stateWith({ l0: [sixFile("s1")] }));
    expect(kindsOf(r)).toEqual([
      "read.memtable-active",
      "read.bloom-false-positive",
      "read.done",
    ]);
    expect(readExtras(r)).toMatchObject({
      key: "blueberry",
      found: false,
      filesProbed: 1,
      blocksProbed: 1,
    });
    expect(r.steps[1].highlights).toEqual([
      { id: "readkey:blueberry", role: "active" },
      { id: "s1", role: "miss" },
      { id: "s1-b1", role: "miss" }, // binary search: last first-key ≤ "blueberry" is "apple"
    ]);
    expect(sstableEntries(r.steps[1].state.l0[0]).some((e) => e.key === "blueberry")).toBe(
      false,
    );
  });

  it("hit: range → bloom → sparse index → block scan returns the value", () => {
    const r = run("read", { key: "cherry" }, stateWith({ l0: [sixFile("s1")] }));
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.l0", "read.done"]);
    expect(readExtras(r)).toMatchObject({
      found: true,
      value: "v2",
      seq: 3,
      filesProbed: 1,
      blocksProbed: 1,
    });
    expect(r.steps[1].highlights).toContainEqual({ id: "s1", role: "hit" });
    expect(r.steps[1].highlights).toContainEqual({ id: "e3", role: "hit" });
  });
});

// ---------------------------------------------------------------------------
// R1 reconciliation
// ---------------------------------------------------------------------------

describe("R1 reconciliation (a hit is not final)", () => {
  it("counter-example: run A x=v1@1, run B x=v2@3, run C no-x higher maxSeq → read returns v2", () => {
    // Flush order (array order) is A, B, C; C's max seq is the highest but C
    // does not hold x. A naive array-order first-hit read would return v1.
    const sA = buildSSTable("sA", [ent("e1", "x", "v1", 1)], 2);
    const sB = buildSSTable("sB", [ent("e3", "x", "v2", 3)], 2);
    const sC = buildSSTable("sC", [ent("e4", "q", "q", 4), ent("e5", "z", "z", 5)], 2);
    const r = run("read", { key: "x" }, stateWith({ l0: [sA, sB, sC] }));
    expect(kindsOf(r)).toEqual([
      "read.memtable-active",
      "read.l0", // sC: bloom says "definitely not"
      "read.l0", // sB: hit v2
      "read.done",
    ]);
    expect(readExtras(r)).toMatchObject({
      found: true,
      value: "v2",
      seq: 3,
      filesProbed: 2,
      blocksProbed: 1, // sA (maxSeq 1 ≤ 3) was never opened
    });
  });

  it("keep-probing: a low-seq hit in the newest file is shadowed by a higher-seq hit in an older file", () => {
    const sA = buildSSTable("sA", [ent("e1", "x", "v1", 1), ent("e9", "y", "y", 9)], 2);
    const sB = buildSSTable("sB", [ent("e3", "x", "v2", 3)], 2);
    const r = run("read", { key: "x" }, stateWith({ l0: [sA, sB] }));
    expect(kindsOf(r)).toEqual([
      "read.memtable-active",
      "read.l0", // sA: hit v1@1, but maxSeq 9 promises nothing newer than it
      "read.l0", // sB: hit v2@3 replaces it
      "read.done",
    ]);
    expect(readExtras(r)).toMatchObject({ found: true, value: "v2", seq: 3 });
    expect(r.steps[2].highlights).toContainEqual({ id: "e1", role: "stale" });
  });

  it("integrated: three real flushes, the newest file lacks the key — the read still returns v2", () => {
    const writes: Array<[string, string]> = [
      // run A
      ["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"], ["e", "e"], ["x", "v1"], // freeze
      ["f", "f"], // flush completes → F1 (x=v1@6)
      // run B
      ["x", "v2"], ["g", "g"], ["h", "h"], ["i", "i"], ["j", "j"], // freeze
      ["k", "k"], // flush completes → F2 (x=v2@8)
      // run C
      ["l", "l"], ["m", "m"], ["n", "n"], ["o", "o"], ["p", "p"], ["q", "q"], // freeze
      ["r", "r"], // flush completes → F3 (no x, maxSeq 19)
    ];
    let s = init();
    for (const [key, value] of writes) s = run("write", { key, value }, s).result;
    expect(s.l0.length).toBe(3);
    const r = run("read", { key: "x" }, s);
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.l0", "read.done"]);
    expect(readExtras(r)).toMatchObject({
      found: true,
      value: "v2",
      seq: 8,
      filesProbed: 1, // F3 range-misses (x ∉ [l, q]); F1 skipped by the R1 stop
      blocksProbed: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Tombstones
// ---------------------------------------------------------------------------

describe("tombstone termination", () => {
  it("a tombstone hit shadows older values: not found, stop", () => {
    const sT = buildSSTable("sT", [ent("e5", "x", "", 5, true)], 2);
    const sV = buildSSTable("sV", [ent("e1", "x", "v1", 1)], 2);
    const r = run("read", { key: "x" }, stateWith({ l0: [sV, sT] }));
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.l0", "read.tombstone"]);
    expect(readExtras(r)).toMatchObject({
      found: false,
      tombstone: true,
      seq: 5,
      filesProbed: 1,
      blocksProbed: 1,
    });
  });

  it("a NEWER write shadows an older tombstone (R1 applies to tombstones too)", () => {
    const sA = buildSSTable("sA", [ent("e5", "x", "", 5, true), ent("e9", "y", "y", 9)], 2);
    const sB = buildSSTable("sB", [ent("e6", "x", "v6", 6)], 2);
    const r = run("read", { key: "x" }, stateWith({ l0: [sA, sB] }));
    expect(kindsOf(r)).toEqual([
      "read.memtable-active",
      "read.l0", // sA: tombstone@5, but sB's maxSeq 6 > 5 keeps the walk going
      "read.l0", // sB: the newer write wins
      "read.done",
    ]);
    expect(readExtras(r)).toMatchObject({
      found: true,
      value: "v6",
      seq: 6,
      tombstone: false,
      filesProbed: 2,
      blocksProbed: 2,
    });
  });

  it("a tombstone in the active MemTable is final", () => {
    const tomb = ent("e1", "x", "", 1, true);
    const r = run(
      "read",
      { key: "x" },
      stateWith({
        memtables: [{ id: "mt1", state: "active", entries: [tomb], walSegment: "w1" }],
        wal: [{ id: "w1", entries: [tomb] }],
      }),
    );
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.tombstone"]);
    expect(readExtras(r)).toMatchObject({ found: false, tombstone: true, seq: 1 });
  });
});

// ---------------------------------------------------------------------------
// Leveled walk
// ---------------------------------------------------------------------------

describe("leveled walk (binary search, at most one file per level)", () => {
  function leveledState(): EngineState {
    return stateWith({
      strategy: "leveled",
      l0: [
        buildSSTable("sL0a", [ent("e11", "apple", "a11", 11), ent("e12", "banana", "b12", 12)], 2),
        buildSSTable(
          "sL0b",
          [ent("e13", "elderberry", "e13", 13), ent("e14", "fig", "f14", 14)],
          2,
        ),
      ],
      levels: [
        [
          buildSSTable("l1a", [ent("e5", "apple", "a5", 5), ent("e6", "banana", "b6", 6)], 2),
          buildSSTable("l1b", [ent("e7", "date", "d7", 7), ent("e8", "elderberry", "e8", 8)], 2),
        ],
        [
          buildSSTable("l2a", [ent("e1", "apple", "a1", 1), ent("e2", "banana", "b2", 2)], 2),
          buildSSTable("l2b", [ent("e3", "date", "d3", 3), ent("e4", "elderberry", "e4", 4)], 2),
        ],
      ],
      seq: 15,
    });
  }

  it("finds a key only in L1: binary search opens exactly one file per level", () => {
    const r = run("read", { key: "date" }, leveledState());
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.level", "read.done"]);
    expect(readExtras(r)).toMatchObject({ found: true, value: "d7", seq: 7 });
  });

  it("an L0 hit shadows the levels (per-key seq decreases down levels)", () => {
    const r = run("read", { key: "apple" }, leveledState());
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.l0", "read.done"]);
    expect(readExtras(r)).toMatchObject({ found: true, value: "a11", seq: 11 });
  });

  it("R1 keep-probing inside L0 (overlapping ranges under leveled)", () => {
    const s = stateWith({
      strategy: "leveled",
      l0: [
        buildSSTable("sOld", [ent("e5", "apple", "a5", 5), ent("e12", "banana", "b12", 12)], 2),
        buildSSTable("sNew", [ent("e11", "apple", "a11", 11), ent("e20", "cherry", "c20", 20)], 2),
      ],
    });
    const r = run("read", { key: "apple" }, s);
    expect(kindsOf(r)).toEqual([
      "read.memtable-active",
      "read.l0", // sNew: apple@11
      "read.l0", // sOld: apple@5 is older — ignored
      "read.done",
    ]);
    expect(readExtras(r)).toMatchObject({ found: true, value: "a11", seq: 11 });
    expect(r.steps[2].highlights).toContainEqual({ id: "e5", role: "stale" });
  });

  it("absent key under leveled: every level is binary-searched, nothing opens", () => {
    const r = run("read", { key: "mango" }, leveledState());
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.done"]);
    expect(readExtras(r)).toMatchObject({ found: false, filesProbed: 0, blocksProbed: 0 });
  });
});

// ---------------------------------------------------------------------------
// Metrics, purity, determinism
// ---------------------------------------------------------------------------

describe("metrics and purity", () => {
  it("accumulates files/blocks across the walk and resets on the next read", () => {
    const sA = buildSSTable("sA", [ent("e1", "apple", "a", 1), ent("e9", "banana", "b", 9)], 2);
    const sB = buildSSTable(
      "sB",
      [ent("e3", "apricot", "p", 3), ent("e4", "cherry", "c", 4)],
      2,
    );
    const r = run(
      "read",
      { key: "apricot" },
      stateWith({ l0: [sA, sB], metrics: { lastReadFiles: 7, lastReadBlocks: 7 } }),
    );
    expect(kindsOf(r)).toEqual(["read.memtable-active", "read.l0", "read.l0", "read.done"]);
    expect(r.steps[0].state.metrics.lastReadFiles).toBe(0); // reset at the first step
    expect(r.steps[1].state.metrics.lastReadFiles).toBe(1); // sA: bloom said no
    expect(r.steps[1].state.metrics.lastReadBlocks).toBe(0);
    expect(r.steps[2].state.metrics.lastReadFiles).toBe(2); // sB: hit
    expect(r.steps[2].state.metrics.lastReadBlocks).toBe(1);
    expect(r.result.metrics.lastReadFiles).toBe(2);
    expect(r.result.metrics.lastReadBlocks).toBe(1);
    expect(readExtras(r)).toMatchObject({ filesProbed: 2, blocksProbed: 1, found: true });

    const second = run("read", { key: "zebra" }, r.result);
    expect(second.steps[0].state.metrics.lastReadFiles).toBe(0); // new read, fresh counters
    expect(second.result.metrics.lastReadFiles).toBe(0);
    expect(second.result.metrics.lastReadBlocks).toBe(0);
  });

  it("touches nothing but metrics (reads never advance jobs or mutate data)", () => {
    let s = init();
    for (const [i, key] of SIX_KEYS.entries()) {
      s = run("write", { key, value: `v${i}` }, s).result;
    }
    const before = JSON.parse(JSON.stringify(s)) as EngineState;
    const r = run("read", { key: "cherry" }, s);
    expect(withoutMetrics(r.result)).toEqual(withoutMetrics(before));
    expect(r.result.jobs).toEqual(before.jobs);
  });

  it("every read step carries the readkey highlight", () => {
    const ops: Array<readonly [string, OpInput]> = [
      ["write", { key: "apple", value: "a" }],
      ["read", { key: "apple" }],
      ["read", { key: "mango" }],
    ];
    for (const r of drive(ops).results) {
      for (const step of r.steps) {
        if (step.kind.startsWith("read.")) {
          expect(step.highlights?.some((h) => h.id.startsWith("readkey:"))).toBe(true);
        }
      }
    }
  });

  it("same inputs twice give deep-equal steps and results", () => {
    const ops: Array<readonly [string, OpInput]> = [
      ["write", { key: "apple", value: "a" }],
      ["write", { key: "kiwi", value: "k" }],
      ["read", { key: "apple" }],
      ["write", { key: "cherry", value: "c" }],
      ["write", { key: "date", value: "d" }],
      ["write", { key: "elderberry", value: "e" }],
      ["write", { key: "fig", value: "f" }], // freeze
      ["read", { key: "cherry" }],
      ["write", { key: "grape", value: "g" }], // flush completes
      ["read", { key: "cherry" }],
      ["read", { key: "blueberry" }],
    ];
    expect(drive(ops)).toEqual(drive(ops));
  });

  it("every step survives a JSON round-trip and result deep-equals the last step", () => {
    const ops: Array<readonly [string, OpInput]> = [
      ["write", { key: "apple", value: "a" }],
      ["write", { key: "kiwi", value: "k" }],
      ["read", { key: "apple" }],
      ["read", { key: "mango" }],
    ];
    for (const r of drive(ops).results) {
      for (const step of r.steps) {
        expect(JSON.parse(JSON.stringify(step.state))).toEqual(step.state);
        expect(step.kind.length).toBeGreaterThan(0);
        expect(step.narration.length).toBeGreaterThan(0);
      }
      if (r.steps.length > 0) expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
    }
  });
});

// ---------------------------------------------------------------------------
// Property test: random write/read sequences against a reference Map
// ---------------------------------------------------------------------------

describe("property: random write/read sequences match a reference Map", () => {
  for (const strategy of ["stcs", "leveled"] as const) {
    it(`strategy ${strategy}: every read agrees with the reference, and reads only touch metrics`, () => {
      const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map(
        (c) => `k${c}`,
      );
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              op: fc.constantFrom("write", "read"),
              key: fc.constantFrom(...alphabet),
              value: fc.integer({ min: 0, max: 999 }),
            }),
            { minLength: 24, maxLength: 120 },
          ),
          (ops) => {
            const reference = new Map<string, { value: string; seq: number }>();
            let state = init({ strategy });
            let seq = 1;
            for (const op of ops) {
              if (op.op === "write") {
                const value = String(op.value);
                const r = run("write", { key: op.key, value }, state);
                expect(r.error).toBeUndefined();
                reference.set(op.key, { value, seq });
                seq += 1;
                state = r.result;
              } else {
                const before = state;
                const r = run("read", { key: op.key }, state);
                expect(r.error).toBeUndefined();
                expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
                const extras = readExtras(r);
                const ref = reference.get(op.key);
                expect(extras.found).toBe(ref !== undefined);
                if (ref !== undefined) {
                  expect(extras.value).toBe(ref.value);
                  expect(extras.seq).toBe(ref.seq);
                }
                expect(extras.filesProbed).toBe(r.result.metrics.lastReadFiles);
                expect(extras.blocksProbed).toBe(r.result.metrics.lastReadBlocks);
                expect(withoutMetrics(r.result)).toEqual(withoutMetrics(before));
                state = r.result;
              }
            }
          },
        ),
        { numRuns: 30, seed: 20261118 },
      );
    });
  }
});
