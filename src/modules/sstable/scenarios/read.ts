/**
 * Scenarios for the read op — filled by the READ lane.
 *
 * Scenario id (PLAN.md §5.3):
 *   - "bloom-false-positive" — a key the bloom filter answers "maybe" for,
 *     but which is not there: the index/block scan finds nothing and the
 *     search continues to the next file.
 *
 * The scenario starts from a deterministic seedState: six keys flushed into
 * one SSTable (its 16-bit bloom filter is a computed by-product) plus one key
 * still in the active MemTable. "blueberry" sorts inside the file's key range
 * and its two hash positions happen to be set, so the filter answers "maybe"
 * although the file never saw the key — a false positive by construction.
 * The second read ("cherry") shows the honest "maybe" path ending in a hit.
 *
 * The seed is built by driving the real engine (init + seven writes), so it
 * can never drift from the write path; the first op is `read`, which is how
 * the shell maps this scenario onto the read button (scenarioForOp).
 *
 * Export signature (lanes must keep it):
 *   export const readScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";
import { init, run } from "../engine/index";

/**
 * Deterministic seed: writes 1–6 fill and freeze the first MemTable; write 7
 * completes the flush (the jobs model), so the state holds one SSTable with
 * apple…fig and a fresh active MemTable holding "honeydew".
 */
function bloomSeedState(): EngineState {
  let state = init();
  const writes: Array<[string, string]> = [
    ["apple", "a0"],
    ["banana", "b0"],
    ["cherry", "c0"],
    ["date", "d0"],
    ["elderberry", "e0"],
    ["fig", "f0"],
    ["honeydew", "h0"],
  ];
  for (const [key, value] of writes) {
    state = run("write", { key, value }, state).result;
  }
  return state;
}

export const readScenarios: Scenario<EngineState>[] = [
  {
    id: "bloom-false-positive",
    title: "Bloom false positive",
    description:
      "A 16-bit bloom filter answers \"maybe\" for \"blueberry\", a key that was never written. The read confirms with the sparse index and a block scan, finds nothing, and reports not found — then reads \"cherry\" for the honest-hit contrast.",
    seedState: bloomSeedState(),
    ops: [
      { opId: "read", input: { key: "blueberry" } },
      { opId: "read", input: { key: "cherry" } },
    ],
  },
];
