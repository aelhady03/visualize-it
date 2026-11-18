/**
 * Scenarios for the compact op — STUB (empty), SPLIT into one array per
 * compaction lane so neither lane has to edit the other's symbol.
 *
 * Lanes:
 *   - `stcsCompactionScenarios`    → the STCS lane fills it.
 *   - `leveledCompactionScenarios` → the leveled lane fills it.
 *
 * Expected scenario ids (PLAN.md §5.3):
 *   - "compaction-stcs"    — enough writes to fill a similar-size bucket,
 *     then the size-tiered merge (stcsCompactionScenarios).
 *   - "compaction-leveled" — an L0 spill into L1 with an overlapping-range
 *     merge (leveledCompactionScenarios).
 *
 * Export signatures (lanes must keep them):
 *   export const stcsCompactionScenarios: Scenario<EngineState>[] = [...]
 *   export const leveledCompactionScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

/** Lane: STCS. */
export const stcsCompactionScenarios: Scenario<EngineState>[] = [];

/** Lane: leveled. */
export const leveledCompactionScenarios: Scenario<EngineState>[] = [];
