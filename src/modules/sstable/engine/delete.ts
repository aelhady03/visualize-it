/**
 * The delete operation (PLAN.md §5.2 Delete) — STUB.
 *
 * Lane: the UPDATE/DELETE lane replaces this file with the real implementation.
 * A tombstone is written through the normal write path (WAL → MemTable →
 * flush). The read path must treat a tombstone hit as "not found" and STOP.
 * Tombstone GC rule (the classic gotcha): a compaction may drop a tombstone
 * only if no OLDER data for that key can exist outside the merge — leveled:
 * bottommost output or no lower level covers the key; stcs: no older file
 * (lower max seq) outside the merge holds the key. Otherwise the tombstone
 * MUST survive or the deleted value resurrects.
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runDelete(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runDelete(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  void input; // replaced by the update/delete lane
  return { steps: [], result: state, error: "not implemented" };
}
