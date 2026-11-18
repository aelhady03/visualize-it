/**
 * Scenarios for the leveled compaction lane — STUB (empty).
 *
 * Lane: leveled compaction lane (replaces this file; keep the export name).
 * Expected scenario id (PLAN.md §5.3): "compaction-leveled" — an L0 spill into
 * L1 with an overlapping-range merge.
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

/** Lane: leveled. */
export const leveledCompactionScenarios: Scenario<EngineState>[] = [];
