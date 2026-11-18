/**
 * Size-tiered compaction (STCS) — STUB. Lane: STCS compaction lane (replaces
 * this file; keep the exact export signature).
 *
 * PLAN.md §5.2 Compact: group l0 files into similar-size buckets; merge a
 * bucket with >= stcsMinThreshold files into one; animated merge-sort over key
 * ranges; stale versions and ELIGIBLE tombstones drop from the merge stream
 * (GC rule: only if no OLDER file outside the merge can hold the key).
 * Write-stall narration belongs to your steps. Step kinds start "compact.".
 *
 * EXACT export signature (engine/compact.ts dispatches to it):
 *   export function runCompactStcs(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runCompactStcs(
  state: EngineState,
  input: OpInput | undefined,
): RunResult<EngineState> {
  void input; // replaced by the STCS lane
  return { steps: [], result: state, error: "not implemented" };
}
