/**
 * Scenarios for the update op — filled by the UPDATE/DELETE lane.
 *
 * Shipped this wave (runnable with ONLY write + update ops):
 *   - "update-immutability" — six writes fill and freeze the first
 *     MemTable; updating one of its keys shows the blind write landing in
 *     the new active MemTable while the flush puts the OLD version on disk:
 *     both versions exist in state, each with its own seq.
 *
 * Deferred to Wave 4 (needs the read op, shipped by the read lane):
 *   - "update-latest-wins" — write, force a flush, update, READ: both
 *     versions visible in different files, seq numbers shown (§5.3).
 *
 * Export signature (lanes must keep it):
 *   export const updateScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const updateScenarios: Scenario<EngineState>[] = [
  {
    id: "update-immutability",
    title: "An update never touches old files",
    description:
      "Six writes fill and freeze the first MemTable. Updating one of its keys is a blind write: the new version lands in the fresh active MemTable while the pending flush puts the OLD version on disk — both versions exist in state, each with its own seq, because SSTables are immutable.",
    ops: [
      { opId: "write", input: { key: "apple", value: "red" } },
      { opId: "write", input: { key: "banana", value: "yellow" } },
      { opId: "write", input: { key: "cherry", value: "dark" } },
      { opId: "write", input: { key: "date", value: "brown" } },
      { opId: "write", input: { key: "elderberry", value: "purple" } },
      { opId: "write", input: { key: "fig", value: "green" } },
      { opId: "update", input: { key: "cherry", value: "red" } },
    ],
  },
];
