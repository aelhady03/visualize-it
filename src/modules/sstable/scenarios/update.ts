/**
 * Scenarios for the update op — filled by the UPDATE/DELETE lane.
 *
 *   - "update-immutability" — six writes fill and freeze the first
 *     MemTable; updating one of its keys shows the blind write landing in
 *     the new active MemTable while the flush puts the OLD version on disk:
 *     both versions exist in state, each with its own seq.
 *   - "update-latest-wins" (Wave 4, PLAN.md §5.3) — write, force a flush,
 *     update, READ: both versions visible in different files with their
 *     seq numbers, and the read returns the NEW value.
 *
 * "update-latest-wins" trace (seed: memtableCap 3): the first three writes
 * fill and freeze the first MemTable; writes 4–5 complete the flush, so
 * s1 lands holding cherry=dark@3. The update then writes cherry=red@6 into
 * the second MemTable — the old entry is highlighted "stale" while it sits
 * untouched in s1 — and fills it to the cap, so writes 7–8 complete that
 * flush: s4 lands holding cherry=red@6. The final read probes s4 (newest
 * file), finds seq 6, and never needs to open s1: the higher seq wins, the
 * stale copy stays put until compaction.
 *
 * Export signature (lanes must keep it):
 *   export const updateScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";
import { init } from "../engine/index";

/** Seed: memtableCap 3 so one flush lands after five writes (demo-friendly). */
const latestWinsSeed: EngineState = init({ memtableCap: 3 });

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
  {
    id: "update-latest-wins",
    title: "Latest wins: an update flushes beside the old version",
    description:
      "Write until a flush puts cherry=dark on disk, then update the key and let that flush land too: both versions now live in different SSTables, each with its own seq. The read walks the newest file first and returns the new value — the old copy stays untouched until compaction.",
    seedState: latestWinsSeed,
    ops: [
      { opId: "write", input: { key: "apple", value: "red" } },
      { opId: "write", input: { key: "banana", value: "yellow" } },
      { opId: "write", input: { key: "cherry", value: "dark" } }, // freeze (cap 3)
      { opId: "write", input: { key: "date", value: "brown" } }, // flush advances 1/2
      { opId: "write", input: { key: "elderberry", value: "purple" } }, // s1 lands: cherry=dark@3
      { opId: "update", input: { key: "cherry", value: "red" } }, // fresh entry @6; fills + freezes
      { opId: "write", input: { key: "fig", value: "green" } }, // flush advances 1/2
      { opId: "write", input: { key: "grape", value: "violet" } }, // s4 lands: cherry=red@6
      { opId: "read", input: { key: "cherry" } }, // newest file wins: red
    ],
  },
];
