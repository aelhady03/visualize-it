/**
 * Scenarios for the write op — STUB (empty).
 *
 * Lane: the READ lane fills this file (the scenario chains writes and then
 * reads, so it can only work once the read op exists).
 *
 * Expected scenario ids (PLAN.md §5.3):
 *   - "write-then-read" — write several keys, read one back.
 *
 * Export signature (lanes must keep it):
 *   export const writeScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const writeScenarios: Scenario<EngineState>[] = [];
