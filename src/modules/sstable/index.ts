/**
 * sstable module entry — the lazy half of module discovery (PLAN.md §3.2).
 *
 * Written ONCE by the Wave 3 module lead (lane: lead). The five lanes do NOT
 * edit this file; they implement the stubs it wires together (engine ops in
 * engine/**, scenarios in scenarios/**, render regions in render/**).
 */

import type { VizModule } from "@core/view-contract";
import { meta, operations, settings } from "./meta";
import { init, run } from "./engine/index";
import { scenarios } from "./scenarios/index";
import { SstableRender } from "./render/index";
import { SstableIntro } from "./Intro";
import type { EngineState } from "./state";

export const sstableModule: VizModule<EngineState> = {
  contractVersion: 1,
  meta,
  operations,
  settings,
  scenarios,
  engine: { init, run },
  Render: SstableRender,
  Intro: SstableIntro,
};

export default sstableModule;
