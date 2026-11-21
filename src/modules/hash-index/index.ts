/**
 * hash-index module entry — the lazy half of module discovery (PLAN.md §3.2).
 */

import type { VizModule } from '@core/view-contract'
import { meta, operations, settings } from './meta'
import { init, run } from './engine'
import { scenarios } from './scenarios'
import { HashIndexRender } from './render'
import { HashIndexIntro } from './Intro'
import type { HashIndexState } from './state'

export const hashIndexModule: VizModule<HashIndexState> = {
  contractVersion: 1,
  meta,
  operations,
  settings,
  scenarios,
  engine: { init, run },
  Render: HashIndexRender,
  Intro: HashIndexIntro,
}

export default hashIndexModule
