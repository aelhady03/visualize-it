/**
 * append-log state model — the simplest storage engine: one append-only file.
 *
 * Plain JSON only (PLAN.md §8): no Map, no Date, no classes, and no field
 * whose meaning depends on `undefined` surviving a round-trip.
 */

import type { Config } from '@core/engine-contract'

export interface LogEntry {
  id: string // stable entity id, `e<seq>` — survives compaction
  key: string
  value: string
  seq: number // logical clock value at write time
}

export interface AppendLogConfig extends Config {
  dedupeOnCompact: boolean
}

export interface AppendLogState {
  seq: number // logical clock: the NEXT sequence number to hand out
  entries: LogEntry[] // the log, oldest first (append = push to the end)
  config: AppendLogConfig // resolved settings
}

export const defaultAppendLogConfig: AppendLogConfig = { dedupeOnCompact: true }

export function resolveConfig(config?: Config): AppendLogConfig {
  const dedupe = config?.dedupeOnCompact
  return { dedupeOnCompact: typeof dedupe === 'boolean' ? dedupe : true }
}

/** Ids of entries shadowed by a newer write to the same key (pure, derived). */
export function staleIds(entries: LogEntry[]): string[] {
  const seen = new Set<string>()
  const stale: string[] = []
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (seen.has(entry.key)) stale.push(entry.id)
    else seen.add(entry.key)
  }
  return stale.reverse()
}
