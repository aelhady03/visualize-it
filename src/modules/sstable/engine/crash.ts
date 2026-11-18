/**
 * The crash & recover operation (PLAN.md §5.2 Crash) — STUB.
 *
 * Lane: the CRASH/BULK lane replaces this file with the real implementation.
 * 1. Simulate the crash: wipe all MemTables (memory is gone), drop all jobs.
 * 2. Replay the UNFLUSHED WAL segments per segment (active and immutable):
 *    rebuild each MemTable from its segment.
 * 3. Restore the `seq` counter to the max seq found in the WAL and the
 *    SSTables — it was in-memory state too; narration says so. Flushed
 *    segments were already truncated, which is why recovery is cheap.
 * Step kinds start with "crash.".
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runCrash(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runCrash(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  void input; // replaced by the crash/bulk lane
  return { steps: [], result: state, error: "not implemented" };
}
