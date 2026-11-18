/**
 * Leveled compaction — STUB. Lane: leveled compaction lane (replaces this
 * file; keep the exact export signature).
 *
 * PLAN.md §5.2 Compact: L0 files overlap (ordered by age); L1+ are single
 * sorted runs in DISJOINT-range files, target sizes ~fanout per level. Merge
 * one Ln file with every overlapping Ln+1 file (L0→L1 takes all overlapping
 * L0 files); output split at targetFileSize. Tombstone GC rule: drop only when
 * the output level is bottommost or no lower level covers the key. Write-stall
 * narration belongs to your steps. Step kinds start "compact.".
 *
 * EXACT export signature (engine/compact.ts dispatches to it):
 *   export function runCompactLeveled(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runCompactLeveled(
  state: EngineState,
  input: OpInput | undefined,
): RunResult<EngineState> {
  void input; // replaced by the leveled lane
  return { steps: [], result: state, error: "not implemented" };
}
