/**
 * _fixture module entry — the lazy half of module discovery (PLAN.md §3.2).
 * Assembles the full `VizModule` and exports it as the default export.
 */

import type { VizModule } from "@core/view-contract";
import { meta, operations, settings } from "./meta";
import { init, run } from "./engine";
import { scenarios } from "./scenarios";
import { FixtureRender } from "./render";
import type { FixtureState } from "./state";

export const fixtureModule: VizModule<FixtureState> = {
  contractVersion: 1,
  meta,
  operations,
  settings,
  scenarios,
  engine: { init, run },
  Render: FixtureRender,
};

export default fixtureModule;
