/**
 * Scenarios for the crash op — the crash/bulk lane.
 *
 * Scenario ids (PLAN.md §5.3):
 *   - "crash-replay" — writes fill the MemTable until it freezes (an
 *     immutable table mid-flush plus a fresh active one), then the engine
 *     crashes: the WAL replays BOTH unflushed segments per segment, rebuilds
 *     the MemTables, and restores the seq counter from the WAL + SSTables. A
 *     follow-up write shows the engine continuing exactly where it left off.
 *
 * Runnable from init() with only the write and crash ops (runConformance
 * check 5) and fully deterministic (check 1).
 *
 * Export signature (lanes must keep it):
 *   export const crashScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const crashScenarios: Scenario<EngineState>[] = [
  {
    id: "crash-replay",
    title: "Crash & WAL replay",
    description:
      "Fill the MemTable until it freezes, then crash the engine. The WAL replays both unflushed segments — the immutable table and the empty active one — rebuilds them, and restores the seq counter; a follow-up write proves recovery picked up exactly where the engine died.",
    ops: [
      { opId: "write", input: { key: "apple", value: "a0" } },
      { opId: "write", input: { key: "banana", value: "b0" } },
      { opId: "write", input: { key: "cherry", value: "c0" } },
      { opId: "write", input: { key: "date", value: "d0" } },
      { opId: "write", input: { key: "elderberry", value: "e0" } },
      { opId: "write", input: { key: "fig", value: "f0" } },
      { opId: "crash" },
      { opId: "write", input: { key: "grape", value: "g0" } },
    ],
  },
];
