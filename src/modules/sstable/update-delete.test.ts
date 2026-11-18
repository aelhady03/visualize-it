import { describe, expect, it } from "vitest";
import type { OpInput } from "@core/engine-contract";
import { init, run } from "./engine/index";
import type { EngineState, Entry } from "./state";
import { entryBytes, hasDuplicateKeysWithinFile, isSorted, sstableEntries } from "./lib/derive";
import { mergeRuns } from "./lib/merge";

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

interface RefVersion {
  value: string;
  tombstone: boolean;
}

/** Newest version of every key, reconciled from memtables + l0 (max seq wins). */
function readLatest(state: EngineState): Map<string, Entry> {
  const runs: Entry[][] = [
    ...state.memtables.map((m) => m.entries),
    ...state.l0.map((sst) => sstableEntries(sst)),
  ];
  return new Map(mergeRuns(runs).map((e) => [e.key, e]));
}

/** §8 invariants + metric accounting, generalized to tombstones. */
function expectInvariants(
  state: EngineState,
  reference: Map<string, RefVersion>,
  ingestedRef: number,
) {
  // memtables sorted; WAL ⊇ its memtable
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
  for (const e of [
    ...state.memtables.flatMap((m) => m.entries),
    ...state.l0.flatMap((sst) => sstableEntries(sst)),
  ]) {
    expect(state.seq).toBeGreaterThan(e.seq);
  }
  // the newest version of every key matches the reference: deleted keys
  // still exist in state, with a TOMBSTONE as their newest entry
  const latest = readLatest(state);
  expect(latest.size).toBe(reference.size);
  for (const [key, want] of reference) {
    const got = latest.get(key);
    expect(got).toBeTruthy();
    expect(got!.value).toBe(want.value);
    expect(got!.tombstone ?? false).toBe(want.tombstone);
  }
  // metric accounting (lib/derive entryBytes is the estimator)
  expect(state.metrics.ingestedBytes).toBe(ingestedRef);
  const fileBytes = state.l0.reduce((s, f) => s + f.bytes, 0);
  const walBytes = state.wal.reduce(
    (s, w) => s + w.entries.reduce((x, e) => x + entryBytes(e), 0),
    0,
  );
  expect(state.metrics.bytesWritten).toBe(fileBytes);
  expect(state.metrics.diskBytes).toBe(fileBytes + walBytes);
}

describe("property: random write/update/delete sequences match a reference Map", () => {
  const seeds = [3, 17, 42];
  const strategies = ["stcs", "leveled"] as const;

  for (const seed of seeds) {
    it(`seed ${seed}: tombstone/value semantics match the reference under both strategies`, () => {
      const rnd = mulberry32(seed);
      const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((c) => `k${c}`);
      const ops = Array.from({ length: 60 }, () => {
        const action = Math.floor(rnd() * 3); // 0 = write, 1 = update, 2 = delete
        const key = alphabet[Math.floor(rnd() * alphabet.length)];
        if (action === 2) return { opId: "delete" as const, key };
        return {
          opId: action === 0 ? ("write" as const) : ("update" as const),
          key,
          value: `${action === 0 ? "v" : "u"}${Math.floor(rnd() * 100)}`,
        };
      });

      for (const strategy of strategies) {
        const reference = new Map<string, RefVersion>();
        let ingestedRef = 0;
        let state = init({ strategy });
        for (const op of ops) {
          const input: OpInput =
            op.opId === "delete" ? { key: op.key } : { key: op.key, value: op.value };
          if (op.opId === "delete") {
            reference.set(op.key, { value: "", tombstone: true });
            ingestedRef += op.key.length;
          } else {
            reference.set(op.key, { value: op.value, tombstone: false });
            ingestedRef += op.key.length + op.value.length;
          }
          const r = run(op.opId, input, state);
          expect(r.error).toBeUndefined();
          if (r.steps.length > 0) expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
          state = r.result;
          expectInvariants(state, reference, ingestedRef);
        }
      }
    });
  }

  it("the same mixed sequence twice gives deep-equal steps and results (determinism)", () => {
    const rnd = mulberry32(9);
    const alphabet = ["a", "b", "c", "d", "e"].map((c) => `k${c}`);
    const ops: Array<{ opId: string; input: OpInput }> = [];
    for (let i = 0; i < 40; i++) {
      const action = Math.floor(rnd() * 3);
      const key = alphabet[Math.floor(rnd() * alphabet.length)];
      if (action === 2) {
        ops.push({ opId: "delete", input: { key } });
      } else {
        ops.push({
          opId: action === 0 ? "write" : "update",
          input: { key, value: `${action === 0 ? "v" : "u"}${Math.floor(rnd() * 100)}` },
        });
      }
    }
    const drive = () => {
      const results = [];
      let state = init();
      for (const op of ops) {
        const r = run(op.opId, op.input, state);
        results.push(r);
        state = r.result;
      }
      return { results, state };
    };
    const first = drive();
    expect(drive()).toEqual(first);
    // and every step state survives a JSON round-trip
    for (const r of first.results) {
      for (const step of r.steps) {
        expect(JSON.parse(JSON.stringify(step.state))).toEqual(step.state);
      }
    }
  });
});
