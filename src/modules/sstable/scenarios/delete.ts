/**
 * Scenarios for the delete op — filled by the UPDATE/DELETE lane.
 *
 * Shipped this wave (runnable with ONLY write + delete ops):
 *   - "delete-tombstone" — six writes fill and freeze the first MemTable;
 *     deleting one of its keys writes a tombstone through the normal path.
 *     The flush that lands during the delete puts the OLD value in an L0
 *     SSTable, while the tombstone (higher seq) sits in the active MemTable
 *     and shadows it.
 *
 * Deferred to Wave 4 (needs the compaction ops, shipped by the two
 * compaction lanes — the kept-vs-dropped contrast IS the lesson):
 *   - "delete-tombstone-kept"   — delete, then a partial compaction: the
 *     tombstone survives because older data could still hide outside it.
 *   - "delete-tombstone-dropped" — delete, then a bottommost/full
 *     compaction: the tombstone is GC'd.
 *
 * Export signature (lanes must keep it):
 *   export const deleteScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const deleteScenarios: Scenario<EngineState>[] = [
  {
    id: "delete-tombstone",
    title: "A delete is a tombstone write",
    description:
      "Six writes fill and freeze the first MemTable. Deleting one of its keys writes a tombstone through the normal path: the flush that lands during the delete puts the OLD value in an L0 SSTable, while the tombstone (higher seq) sits in the active MemTable and shadows it — the key reads as missing, but the old bytes stay until compaction.",
    ops: [
      { opId: "write", input: { key: "apple", value: "red" } },
      { opId: "write", input: { key: "banana", value: "yellow" } },
      { opId: "write", input: { key: "cherry", value: "dark" } },
      { opId: "write", input: { key: "date", value: "brown" } },
      { opId: "write", input: { key: "elderberry", value: "purple" } },
      { opId: "write", input: { key: "fig", value: "green" } },
      { opId: "delete", input: { key: "cherry" } },
    ],
  },
];
