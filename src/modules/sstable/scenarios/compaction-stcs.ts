/**
 * Scenarios for the STCS compaction lane.
 *
 * Expected scenario id (PLAN.md §5.3): "compaction-stcs" — enough writes to
 * fill a similar-size bucket, then the size-tiered merge. Runnable with only
 * `write` + `compact` ops; keeps the exact export name:
 *
 *   export const stcsCompactionScenarios: Scenario<EngineState>[] = [...]
 *
 * The seed state lowers memtableCap to 3 so the demo reaches the compaction
 * state after 13 writes instead of 25. Trace (cap 3): every third write
 * freezes the MemTable, the next write completes the flush, so files land
 * after writes 4, 7, 10 and 13 — four similar-size 3-entry files in L0:
 *   s1 = k1v1, k2v2, k3v3      s4 = k4v4, k5v5, k6v6
 *   s7 = k1v7, k7v8, k8v9      s10 = k2v11, k9v10, k10v12
 * k1 and k2 were updated across files, so the merge drops their stale
 * versions (k1v1, k2v2) and keeps the highest seq — the size-tiered lesson.
 * Then five compact ops: the first starts the job (4 units = 4 input files),
 * the next three advance it 1→3/4 (write-stall narration fires each time:
 * L0 is at the l0Trigger of 4), and the fifth completes the merge: s14
 * lands with 10 entries and the 4 inputs are consumed.
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";
import { init } from "../engine/index";

/** Seed: memtableCap 3 so four files land after 13 writes, no job in flight. */
const seedState: EngineState = init({ memtableCap: 3 });

const writes: Array<{ key: string; value: string }> = [
  { key: "k1", value: "v1" },
  { key: "k2", value: "v2" },
  { key: "k3", value: "v3" },
  { key: "k4", value: "v4" },
  { key: "k5", value: "v5" },
  { key: "k6", value: "v6" },
  { key: "k1", value: "v7" }, // update across files: stale v1 will drop
  { key: "k7", value: "v8" },
  { key: "k8", value: "v9" },
  { key: "k9", value: "v10" },
  { key: "k2", value: "v11" }, // update across files: stale v2 will drop
  { key: "k10", value: "v12" },
  { key: "k11", value: "v13" },
];

export const stcsCompactionScenarios: Scenario<EngineState>[] = [
  {
    id: "compaction-stcs",
    title: "Size-tiered compaction",
    description:
      "Write until L0 holds a bucket of similar-size files, then run compact: the bucket merges into one SSTable, stale versions drop out, and writes stall while the merge is in flight.",
    seedState,
    ops: [
      ...writes.map((w) => ({ opId: "write" as const, input: { key: w.key, value: w.value } })),
      // 1: start the merge job (4 units = 4 inputs). 2–4: advance 1→3/4 with
      // write-stall narration. 5: advance to 4/4 and complete the merge.
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
    ],
  },
];
