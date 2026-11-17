/**
 * Module discovery (PLAN.md §3.2) — two globs, no hand-edited registry.
 *
 * - `meta.ts`  (eager): every module exports `meta`, `operations` and `settings`
 *   from a tiny file so the sidebar builds without loading any engine.
 * - `index.ts` (lazy): exports the full `VizModule`, loaded per route.
 *
 * Adding a module is purely additive: drop a folder under `src/modules/<id>/`
 * with both files and it is discovered automatically. A repository with zero
 * modules yields an empty list — no crash. A folder that has only one of the
 * two files is a hard error (the sidebar would otherwise show modules that can
 * never load).
 */

import type { Operation, SettingSpec } from './engine-contract'
import type { VizModule } from './view-contract'

/** What the sidebar needs about a module — exactly what `meta.ts` exports. */
export interface ModuleSummary {
  meta: VizModule<unknown>['meta']
  operations: Operation[]
  settings: SettingSpec[]
}

type IndexLoader = () => Promise<{ default?: VizModule<unknown>; module?: VizModule<unknown> } | VizModule<unknown>>

const metaModules = import.meta.glob('/src/modules/*/meta.ts', { eager: true }) as Record<
  string,
  ModuleSummary
>
const indexModules = import.meta.glob('/src/modules/*/index.ts') as Record<string, IndexLoader>

const META_RE = /^\/src\/modules\/([^/]+)\/meta\.ts$/
const INDEX_RE = /^\/src\/modules\/([^/]+)\/index\.ts$/

/** Module ids found by one glob. */
function folderIds(entries: Record<string, unknown>, regex: RegExp): Set<string> {
  const ids = new Set<string>()
  for (const path of Object.keys(entries)) {
    const match = regex.exec(path)
    if (match) ids.add(match[1])
  }
  return ids
}

/**
 * Every module folder must export BOTH `meta.ts` and `index.ts`; otherwise
 * discovery is inconsistent (sidebar entries that can never load, or loadable
 * modules invisible to the sidebar). Throws with one message per offender.
 * Empty sets (zero modules) are fine.
 */
export function validateModuleSets(metaIds: Set<string>, indexIds: Set<string>): void {
  const problems: string[] = []
  for (const id of metaIds) {
    if (!indexIds.has(id)) problems.push(`module "${id}" has meta.ts but no index.ts`)
  }
  for (const id of indexIds) {
    if (!metaIds.has(id)) problems.push(`module "${id}" has index.ts but no meta.ts`)
  }
  if (problems.length > 0) {
    throw new Error(`Module discovery is inconsistent: ${problems.join('; ')}`)
  }
}

/** Sort order for the sidebar: `meta.category` (alphabetical), then `meta.order`. */
export function sortSummaries(summaries: ModuleSummary[]): ModuleSummary[] {
  return [...summaries].sort(
    (a, b) => a.meta.category.localeCompare(b.meta.category) || a.meta.order - b.meta.order,
  )
}

function assertGlobsConsistent(): void {
  validateModuleSets(folderIds(metaModules, META_RE), folderIds(indexModules, INDEX_RE))
}

/**
 * All discovered modules, sorted by `meta.category` then `meta.order`.
 * Synchronous (the meta glob is eager) and tolerant of zero modules.
 */
export function getModules(): ModuleSummary[] {
  assertGlobsConsistent()
  return sortSummaries(
    Object.entries(metaModules).map(([, summary]) => ({
      meta: summary.meta,
      operations: summary.operations,
      settings: summary.settings,
    })),
  )
}

const moduleCache = new Map<string, Promise<VizModule<unknown>>>()

/**
 * Lazily load one module's full `VizModule` (engine + Render + scenarios).
 * The promise is cached, so routes and the player share one instance.
 * Rejects for unknown ids; `index.ts` may export the module as `default`
 * (or as a named `module` export).
 */
export function loadModule(id: string): Promise<VizModule<unknown>> {
  const cached = moduleCache.get(id)
  if (cached) return cached

  const path = `/src/modules/${id}/index.ts`
  const loader = indexModules[path]
  if (!loader) {
    return Promise.reject(new Error(`Unknown module "${id}": no ${path} was found`))
  }

  const promise = loader().then((loaded) => {
    const candidate =
      loaded !== null && typeof loaded === 'object' && 'default' in loaded
        ? (loaded.default ?? loaded.module)
        : loaded
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !('meta' in candidate) ||
      !('engine' in candidate) ||
      !('Render' in candidate)
    ) {
      throw new Error(`Module "${id}": index.ts must export its VizModule as the default export`)
    }
    return candidate as VizModule<unknown>
  })
  moduleCache.set(id, promise)
  return promise
}
