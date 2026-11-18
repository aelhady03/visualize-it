/**
 * The bulk write operation (PLAN.md §5.2 Bulk write) — the sandbox helper
 * that reaches flush and compaction states without typing 30 writes.
 *
 * `count` seeded random key/value pairs are inserted through the NORMAL write
 * path: each insert is a full engine/write.ts run, so freeze, flush and
 * trigger behavior is identical to typing the writes one by one. The only
 * difference is the step kinds: every write-path kind is prefixed with
 * `bulk.`, so the whole run groups under one chapter (PLAN.md §3.3) and the
 * player can fast-forward it.
 *
 * Deterministic (contract §3.1): a local mulberry32 PRNG seeded from the
 * `seed` input — never Math.random, never Date.now. Input schema (meta.ts):
 * count (number), seed (number).
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runBulk(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult, Step } from "@core/engine-contract";
import type { EngineState } from "../state";
import { runWrite } from "./write";

/** Deterministic PRNG (mulberry32) — local, pure, dependency-free. */
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

/**
 * The seeded key pool: short keys so repeats happen (in-place replaces and
 * staleness show up) while distinct keys still fill the MemTables.
 */
const KEY_POOL = [
  "apple",
  "banana",
  "cherry",
  "date",
  "elderberry",
  "fig",
  "grape",
  "honeydew",
  "kiwi",
  "lemon",
  "mango",
  "nectarine",
  "orange",
  "pear",
  "plum",
  "quince",
];

/** One generated key/value pair. */
export interface BulkOp {
  key: string;
  value: string;
}

/**
 * The exact (count, seed) → op list the bulk runner replays through the
 * write path. Exported so tests can build a reference Map and assert the
 * bulk run matches it without reimplementing the generator.
 */
export function generateBulkOps(count: number, seed: number): BulkOp[] {
  const rnd = mulberry32(seed);
  const ops: BulkOp[] = [];
  for (let i = 0; i < count; i++) {
    ops.push({
      key: KEY_POOL[Math.floor(rnd() * KEY_POOL.length)],
      value: `v${Math.floor(rnd() * 1000)}`,
    });
  }
  return ops;
}

export function runBulk(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  const count = input?.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) {
    // Contract: `error` is for INVALID INPUT ONLY.
    return { steps: [], result: state, error: "invalid input: count must be a positive integer" };
  }
  const seed = input?.seed;
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return { steps: [], result: state, error: "invalid input: seed must be a finite number" };
  }

  const steps: Step<EngineState>[] = [];
  let current = state;
  for (const op of generateBulkOps(Math.floor(count), Math.floor(seed))) {
    const res = runWrite({ key: op.key, value: op.value }, current);
    current = res.result;
    for (const s of res.steps) {
      steps.push({ ...s, kind: `bulk.${s.kind}` });
    }
  }

  return { steps, result: current };
}
