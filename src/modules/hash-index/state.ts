/**
 * hash-index state model — a Bitcask-style engine: one append-only file on
 * disk plus an in-memory hash index mapping every key to the byte offset of
 * its newest entry.
 *
 * Plain JSON only (PLAN.md §8): no Map, no Date, no classes, and no field
 * whose meaning depends on `undefined` surviving a round-trip. The index is
 * therefore a `Record<string, number>`, not a `Map`.
 *
 * Entity ids: file entries use `e<seq>`; index rows use the derived id
 * `idx:<key>` (see `indexRowId`), which the engine's highlights and the
 * render agree on.
 */

import type { Config } from '@core/engine-contract'

export interface FileEntry {
  id: string // stable entity id, `e<seq>` — survives compaction
  key: string
  value: string
  seq: number // logical clock value at write time
  offset: number // byte offset of this record in the file
  tombstone?: boolean // deletion marker (only via hand-built/seed states)
}

export interface HashIndexConfig extends Config {
  dedupeOnCompact: boolean
}

export interface HashIndexState {
  seq: number // logical clock: the NEXT sequence number to hand out
  file: FileEntry[] // the append-only data file, oldest first
  index: Record<string, number> // key -> byte offset of its NEWEST entry
  config: HashIndexConfig // resolved settings
}

export const defaultHashIndexConfig: HashIndexConfig = { dedupeOnCompact: true }

export function resolveConfig(config?: Config): HashIndexConfig {
  const dedupe = config?.dedupeOnCompact
  return { dedupeOnCompact: typeof dedupe === 'boolean' ? dedupe : true }
}

/** Record size in bytes: a fixed 16-byte header plus key and value bytes. */
export function entryBytes(entry: Pick<FileEntry, 'key' | 'value'>): number {
  return 16 + entry.key.length + entry.value.length
}

/** Byte offset where a new entry appended after the current file tail lands. */
export function nextOffset(file: FileEntry[]): number {
  const tail = file[file.length - 1]
  return tail === undefined ? 0 : tail.offset + entryBytes(tail)
}

/** Stable entity id of an index row (engine highlights + render agree on this). */
export function indexRowId(key: string): string {
  return `idx:${key}`
}

/** Ids of entries shadowed by a newer write to the same key (pure, derived). */
export function staleIds(entries: FileEntry[]): string[] {
  const seen = new Set<string>()
  const stale: string[] = []
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (seen.has(entry.key)) stale.push(entry.id)
    else seen.add(entry.key)
  }
  return stale.reverse()
}

/**
 * Ids dropped by a deduping compaction pass: every entry whose key has a
 * newer entry, plus — when a key's newest entry is a tombstone — every entry
 * of that key (classic tombstone GC: the key is gone, so all its versions go).
 */
export function droppedIds(entries: FileEntry[]): Set<string> {
  const newest = new Map<string, FileEntry>()
  for (const entry of entries) newest.set(entry.key, entry)
  const dropped = new Set<string>()
  for (const entry of entries) {
    const latest = newest.get(entry.key)
    if (latest !== undefined && (latest.id !== entry.id || latest.tombstone === true)) {
      dropped.add(entry.id)
    }
  }
  return dropped
}

/**
 * The invariant every committed state must satisfy: the index maps exactly
 * the keys present in the file, each to the byte offset of that key's NEWEST
 * entry. (Intermediate steps of a compaction may temporarily violate it, but
 * every operation's `result` restores it.)
 */
export function indexInvariant(state: HashIndexState): boolean {
  const last = new Map<string, number>()
  for (const entry of state.file) last.set(entry.key, entry.offset)
  if (last.size !== Object.keys(state.index).length) return false
  for (const [key, offset] of Object.entries(state.index)) {
    if (last.get(key) !== offset) return false
  }
  return true
}
