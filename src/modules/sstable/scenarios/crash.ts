/**
 * Scenarios for the crash op — the crash/bulk lane.
 *
 * Scenario ids (PLAN.md §5.3):
 *   - "crash-replay" — writes fill the MemTable until it freezes (an
 *     immutable table mid-flush plus a fresh active one), then the engine
 *     crashes: the WAL replays BOTH unflushed segments per segment, rebuilds
 *     the MemTables, re-queues the flush for the immutable one, and restores
 *     the seq counter from the WAL + SSTables. Two follow-up writes show the
 *     engine continuing where it left off — the second one completes the
 *     re-queued flush, so the replayed data reaches disk as an SSTable.
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
      "Fill the MemTable until it freezes, then crash the engine. The WAL replays both unflushed segments — the immutable table and the empty active one — rebuilds them, re-queues the flush, and restores the seq counter; two follow-up writes show recovery continuing and the replayed data landing in an SSTable.",
    ops: [
      { opId: "write", input: { key: "apple", value: "a0" } },
      { opId: "write", input: { key: "banana", value: "b0" } },
      { opId: "write", input: { key: "cherry", value: "c0" } },
      { opId: "write", input: { key: "date", value: "d0" } },
      { opId: "write", input: { key: "elderberry", value: "e0" } },
      { opId: "write", input: { key: "fig", value: "f0" } },
      { opId: "crash" },
      { opId: "write", input: { key: "grape", value: "g0" } },
      { opId: "write", input: { key: "kiwi", value: "k0" } },
    ],
  },
];
