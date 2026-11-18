/**
 * The update operation (PLAN.md §5.2 Update) — STUB.
 *
 * Lane: the UPDATE/DELETE lane replaces this file with the real implementation.
 * Update is mechanically the write path — the narration is the lesson: a
 * blind write (no read-before-write), files stay immutable so the old value
 * survives until compaction, and an in-memory key in the active MemTable is
 * replaced before it ever reaches disk. Reuse the write path (engine/write.ts)
 * with update-specific step kinds/narration.
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runUpdate(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runUpdate(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  void input; // replaced by the update/delete lane
  return { steps: [], result: state, error: "not implemented" };
}
