/**
 * Scenarios for the update op — STUB (empty).
 *
 * Lane: the UPDATE/DELETE lane fills this file.
 *
 * Expected scenario ids (PLAN.md §5.3):
 *   - "update-latest-wins" — write, force a flush, update, read: both
 *     versions visible in different files, each with its seq.
 *
 * Export signature (lanes must keep it):
 *   export const updateScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const updateScenarios: Scenario<EngineState>[] = [];
