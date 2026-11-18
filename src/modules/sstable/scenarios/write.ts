/**
 * Scenarios for the write op — filled by the READ lane (the scenario chains
 * writes and then reads, so it only works once the read op exists).
 *
 * Scenario id (PLAN.md §5.3):
 *   - "write-then-read" — write several keys, read one back.
 *
 * Export signature (lanes must keep it):
 *   export const writeScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const writeScenarios: Scenario<EngineState>[] = [
  {
    id: "write-then-read",
    title: "Write several keys, then read one back",
    description:
      "Three writes land in the active MemTable (sorted, via the WAL). The read of \"plum\" hits the newest data in memory and stops; the read of \"mango\" probes the empty tree and reports not found.",
    ops: [
      { opId: "write", input: { key: "apple", value: "red" } },
      { opId: "write", input: { key: "kiwi", value: "green" } },
      { opId: "write", input: { key: "plum", value: "purple" } },
      { opId: "read", input: { key: "plum" } },
      { opId: "read", input: { key: "mango" } },
    ],
  },
];
