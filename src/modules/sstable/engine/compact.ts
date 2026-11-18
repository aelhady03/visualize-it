/**
 * The compact operation (PLAN.md §5.2 Compact) — STUB.
 *
 * Lane: SHARED by the two compaction lanes — dispatch by `state.config.strategy`
 * inside runCompact:
 *   - "stcs"   → the STCS lane (size-tiered): group l0 files into similar-size
 *                buckets, merge a bucket with ≥ stcsMinThreshold files,
 *                animated merge-sort, stale versions and ELIGIBLE tombstones
 *                drop from the merge stream.
 *   - "leveled"→ the leveled lane: merge one Ln file with every overlapping
 *                Ln+1 file (L0→L1 takes all overlapping L0 files), output
 *                split at targetFileSize, levels stay disjoint.
 * Both lanes must agree on this file's structure — coordinate ownership
 * through the coordinator (lead). Triggers, write stalls and the tombstone
 * GC rule all live here (§5.2). Step kinds start with "compact.".
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runCompact(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runCompact(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  void input; // replaced by the STCS + leveled compaction lanes
  return { steps: [], result: state, error: "not implemented" };
}
