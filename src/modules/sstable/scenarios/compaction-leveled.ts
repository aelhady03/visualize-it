/**
 * Scenarios for the leveled compaction lane (PLAN.md §5.3).
 *
 * "compaction-leveled" — an L0 spill into L1 with an overlapping-range merge.
 * Runs under strategy "leveled" (baked into the seed state, since a scenario
 * can't touch the settings toggle) using ONLY write + compact ops. The seed
 * also shrinks memtableCap to 4 and l0Trigger to 2 so the lesson fits in a
 * handful of operations.
 *
 * The write choreography: a flush lands one write after each freeze (writes
 * 5 and 9). The two flushes share keys k3–k4, so the two L0 files overlap —
 * the L0 spill picks the whole group and merges 6 distinct keys into L1.
 * Repeats carry new values so the merge visibly drops stale versions
 * (highest seq wins).
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";
import { init } from "../engine/index";

/** Strategy + demo-friendly sizes are part of the resolved config (PLAN.md §3.1). */
const seedState: EngineState = init({ strategy: "leveled", memtableCap: 4, l0Trigger: 2 });

export const leveledCompactionScenarios: Scenario<EngineState>[] = [
  {
    id: "compaction-leveled",
    title: "Leveled compaction: L0 spills into L1",
    description:
      "Fill L0 with two overlapping files, then press compact: the oldest file pulls the overlapping file into one sorted L1 run, stale versions drop, and L0 empties.",
    seedState,
    ops: [
      { opId: "write", input: { key: "k1", value: "v1" } },
      { opId: "write", input: { key: "k2", value: "v2" } },
      { opId: "write", input: { key: "k3", value: "v3" } },
      { opId: "write", input: { key: "k4", value: "v4" } }, // freeze (cap 4)
      { opId: "write", input: { key: "k3", value: "v3b" } }, // flush 1 lands: k1–k4
      { opId: "write", input: { key: "k4", value: "v4b" } },
      { opId: "write", input: { key: "k5", value: "v5" } },
      { opId: "write", input: { key: "k6", value: "v6" } }, // freeze
      { opId: "write", input: { key: "k5", value: "v5b" } }, // flush 2 lands: k3–k6 → L0 ≥ trigger
      { opId: "write", input: { key: "k7", value: "v7" } },
      // Press 1: picks the whole overlapping group (job 1/2), stall narrated.
      // Press 2: last unit + completion — outputs land in L1, inputs removed.
      // Press 3: nothing left to compact.
      { opId: "compact" },
      { opId: "compact" },
      { opId: "compact" },
    ],
  },
];
