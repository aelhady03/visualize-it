/**
 * The bulk write operation (PLAN.md §5.2 Bulk write) — STUB.
 *
 * Lane: the CRASH/BULK lane replaces this file with the real implementation.
 * Sandbox helper op: insert `count` random keys through the NORMAL write path
 * (reuse engine/write.ts so flushes and triggers behave identically), driven
 * by a SEEDED PRNG (determinism — contract §3.1; never Math.random, never
 * Date.now). Input schema (meta.ts): count (number), seed (number). Emits the
 * same step kinds as the writes it performs; consider grouping them under a
 * "bulk." chapter prefix (PLAN.md §3.3).
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runBulk(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runBulk(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  void input; // replaced by the crash/bulk lane
  return { steps: [], result: state, error: "not implemented" };
}
