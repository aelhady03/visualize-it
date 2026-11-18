/**
 * Scenarios for the crash op — STUB (empty).
 *
 * Lane: the CRASH/BULK lane fills this file.
 *
 * Expected scenario ids (PLAN.md §5.3):
 *   - "crash-replay" — writes, a crash, then the WAL replay rebuilding the
 *     memtables (with the seq counter restored from the WAL + SSTables).
 *
 * Export signature (lanes must keep it):
 *   export const crashScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";

export const crashScenarios: Scenario<EngineState>[] = [];
