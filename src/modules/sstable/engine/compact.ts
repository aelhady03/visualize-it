/**
 * The compact operation (PLAN.md §5.2 Compact) — DISPATCHER (integrator-owned,
 * written once; lanes fill only their own file below).
 *
 *   - "stcs"    → runCompactStcs    (engine/compact-stcs.ts, STCS lane)
 *   - "leveled" → runCompactLeveled (engine/compact-leveled.ts, leveled lane)
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runCompact(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";
import { runCompactStcs } from "./compact-stcs";
import { runCompactLeveled } from "./compact-leveled";

export function runCompact(
  state: EngineState,
  input: OpInput | undefined,
): RunResult<EngineState> {
  return state.config.strategy === "stcs"
    ? runCompactStcs(state, input)
    : runCompactLeveled(state, input);
}
