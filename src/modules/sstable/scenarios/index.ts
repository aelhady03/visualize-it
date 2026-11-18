/**
 * sstable guided scenarios — the concatenation of the six per-op scenario
 * files. Written ONCE by the Wave 3 module lead (lane: lead); lanes fill the
 * stub files, never this one.
 *
 * The shell maps an operation button in guided mode to the first scenario
 * whose id equals the op id, else whose first op matches it (PLAN.md §3.1).
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";
import { writeScenarios } from "./write";
import { readScenarios } from "./read";
import { updateScenarios } from "./update";
import { deleteScenarios } from "./delete";
import { leveledCompactionScenarios, stcsCompactionScenarios } from "./compaction";
import { crashScenarios } from "./crash";

export const scenarios: Scenario<EngineState>[] = [
  ...writeScenarios,
  ...readScenarios,
  ...updateScenarios,
  ...deleteScenarios,
  ...stcsCompactionScenarios,
  ...leveledCompactionScenarios,
  ...crashScenarios,
];
