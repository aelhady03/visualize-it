/**
 * append-log module entry — the lazy half of module discovery (PLAN.md §3.2).
 */

import type { VizModule } from '@core/view-contract'
import { meta, operations, settings } from './meta'
import { init, run } from './engine'
import { scenarios } from './scenarios'
import { AppendLogRender } from './render'
import { AppendLogIntro } from './Intro'
import type { AppendLogState } from './state'

export const appendLogModule: VizModule<AppendLogState> = {
  contractVersion: 1,
  meta,
  operations,
  settings,
  scenarios,
  engine: { init, run },
  Render: AppendLogRender,
  Intro: AppendLogIntro,
}

export default appendLogModule
