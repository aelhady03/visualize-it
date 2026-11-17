// Diff highlighting (PLAN.md §3.3): the shell diffs consecutive state
// snapshots by entity id and marks added/removed entities with the `new` /
// `removed` role colors, which the Render applies to its highlights prop.
//
// Entities live in arrays (wal[], memtables[], l0[], levels[][], jobs[],
// blocks[], entries[]); an entity is any array item with a string `id`.
// Walking only array items avoids treating plain records (config, metrics)
// as entities.

import type { Highlight } from '@core/engine-contract'

/** Collect every entity id reachable in a snapshot. */
export function collectEntityIds(value: unknown, ids: Set<string>): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        const id = (item as { id?: unknown }).id
        if (typeof id === 'string') ids.add(id)
      }
      collectEntityIds(item, ids)
    }
    return
  }
  for (const v of Object.values(value)) collectEntityIds(v, ids)
}

/**
 * Merge the engine's step highlights with shell-computed diff highlights:
 * ids present in `state` but not `prevState` get role 'new', ids present in
 * `prevState` but not `state` get role 'removed'. Engine highlights win for
 * the same (id, role) pair. `prevState === undefined` (first step) yields no
 * diff highlights.
 */
export function diffHighlights(
  prevState: unknown,
  state: unknown,
  stepHighlights?: Highlight[],
): Highlight[] {
  const merged: Highlight[] = [...(stepHighlights ?? [])]
  const seen = new Set(merged.map((h) => `${h.id}:${h.role}`))

  const push = (id: string, role: Highlight['role']) => {
    const key = `${id}:${role}`
    if (seen.has(key)) return
    seen.add(key)
    merged.push({ id, role })
  }

  if (prevState === undefined) return merged

  const prevIds = new Set<string>()
  const currentIds = new Set<string>()
  collectEntityIds(prevState, prevIds)
  collectEntityIds(state, currentIds)

  for (const id of currentIds) if (!prevIds.has(id)) push(id, 'new')
  for (const id of prevIds) if (!currentIds.has(id)) push(id, 'removed')

  return merged
}
