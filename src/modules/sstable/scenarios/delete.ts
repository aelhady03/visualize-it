/**
 * Scenarios for the delete op — STUB (empty).
 *
 * Lane: the UPDATE/DELETE lane fills this file.
 *
 * Expected scenario ids (PLAN.md §5.3 — the kept-vs-dropped contrast is the
 * lesson; they also need the compaction lanes' work):
 *   - "delete-tombstone-kept"   — delete, then a partial compaction: the
 *     tombstone survives because older data could still hide outside it.
 *   - "delete-tombstone-dropped" — delete, then a bottommost/full
 *     compaction: the tombstone is GC'd.
 *
 * Export signature (lanes must keep it):
 *   export const deleteScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const deleteScenarios: Scenario<EngineState>[] = [];
