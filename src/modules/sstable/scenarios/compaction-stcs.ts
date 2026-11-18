/**
 * Scenarios for the STCS compaction lane — STUB (empty).
 *
 * Lane: STCS compaction lane (replaces this file; keep the export name).
 * Expected scenario id (PLAN.md §5.3): "compaction-stcs" — enough writes to
 * fill a similar-size bucket, then the size-tiered merge.
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

/** Lane: STCS. */
export const stcsCompactionScenarios: Scenario<EngineState>[] = [];
