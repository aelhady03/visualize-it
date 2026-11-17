// Module loading via React's `use()` — pages throw the loadModule promise
// into a <Suspense> boundary ("lazy-loaded via loadModule, suspense fallback")
// and let the ErrorBoundary handle unknown module ids.

import { use } from 'react'
import { loadModule } from '@core/discovery'
import type { VizModule } from '@core/view-contract'

const cache = new Map<string, Promise<VizModule<unknown>>>()

export function loadModuleCached(id: string): Promise<VizModule<unknown>> {
  let promise = cache.get(id)
  if (!promise) {
    promise = loadModule(id)
    cache.set(id, promise)
  }
  return promise
}

export function useModule(id: string): VizModule<unknown> {
  return use(loadModuleCached(id))
}
