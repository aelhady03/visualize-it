/**
 * Scenarios for the read op — STUB (empty).
 *
 * Lane: the READ lane fills this file.
 *
 * Expected scenario ids (PLAN.md §5.3):
 *   - "bloom-false-positive" — a key the bloom filter answers "maybe" for,
 *     but which is not there: index/block scan finds nothing and the search
 *     continues to the next file.
 *
 * Export signature (lanes must keep it):
 *   export const readScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const readScenarios: Scenario<EngineState>[] = [];
