/**
 * hash-index engine — pure and deterministic (imports only
 * `@core/engine-contract` and this module's pure files).
 *
 * Operations:
 * - `write`   → `hash.write-append`, `hash.index-set`
 * - `read`    → `hash.index-lookup`, then `hash.read-hit` | `hash.read-miss`
 * - `compact` → `hash.compact-scan`, `hash.compact-drop`, `hash.compact-rebuild`
 *
 * Determinism (PLAN.md §8): a logical `seq` clock, byte offsets derived from
 * record sizes, no randomness. A read that finds nothing is a normal
 * `hash.read-miss`, never an error; `error` is reserved for invalid input
 * (empty key, unknown op id).
 */

import type { Config, Highlight, OpInput, RunResult, Step } from '@core/engine-contract'
import {
  droppedIds,
  entryBytes,
  indexRowId,
  nextOffset,
  resolveConfig,
  type FileEntry,
  type HashIndexState,
} from '../state'

type S = HashIndexState

export function init(config?: Config): S {
  return { seq: 1, file: [], index: {}, config: resolveConfig(config) }
}

export function run(opId: string, input: OpInput | undefined, prev: S): RunResult<S> {
  switch (opId) {
    case 'write':
      return write(input, prev)
    case 'read':
      return read(input, prev)
    case 'compact':
      return compact(prev)
    default:
      return { steps: [], result: prev, error: `unknown op id "${opId}"` }
  }
}

function keyOf(input: OpInput | undefined): string {
  const raw = input?.key
  return raw === undefined ? '' : String(raw).trim()
}

function fileBytes(file: FileEntry[]): number {
  return file.reduce((sum, entry) => sum + entryBytes(entry), 0)
}

function write(input: OpInput | undefined, prev: S): RunResult<S> {
  const key = keyOf(input)
  if (key === '') return { steps: [], result: prev, error: 'write needs a non-empty key' }
  const value = input?.value === undefined ? '' : String(input.value)

  const offset = nextOffset(prev.file)
  const entry: FileEntry = { id: `e${prev.seq}`, key, value, seq: prev.seq, offset }
  const appended: S = { ...prev, seq: prev.seq + 1, file: [...prev.file, entry] }
  const shadowed = prev.file.filter((e) => e.key === key)

  const append: Step<S> = {
    kind: 'hash.write-append',
    state: appended,
    narration: `${key}=${value} is appended to the end of the file at byte offset ${offset}. Appending never seeks or rewrites, which is the fastest possible write.`,
    highlights: [{ id: entry.id, role: 'new' }],
    metrics: {
      fileBytes: fileBytes(appended.file),
      indexEntries: Object.keys(appended.index).length,
    },
  }

  const indexed: S = { ...appended, index: { ...appended.index, [key]: offset } }
  const indexSet: Step<S> = {
    kind: 'hash.index-set',
    state: indexed,
    narration:
      shadowed.length > 0
        ? `The in-memory index repoints ${key} to byte offset ${offset} — the new version wins the instant the index is updated. The ${shadowed.length} older version(s) stay in the file but nothing points at them anymore.`
        : `The in-memory index gets ${key} → ${offset}, so a later read can jump straight to this record with one seek.`,
    why: 'The index lives entirely in RAM. That is the whole deal: memory in exchange for O(1) point reads.',
    highlights: [
      { id: entry.id, role: 'active' },
      { id: indexRowId(key), role: 'new' },
      ...shadowed.map((e) => ({ id: e.id, role: 'stale' as const })),
    ],
    metrics: {
      fileBytes: fileBytes(indexed.file),
      indexEntries: Object.keys(indexed.index).length,
    },
  }
  return { steps: [append, indexSet], result: indexed }
}

function read(input: OpInput | undefined, prev: S): RunResult<S> {
  const key = keyOf(input)
  if (key === '') return { steps: [], result: prev, error: 'read needs a non-empty key' }

  const offset = prev.index[key]
  const indexEntries = Object.keys(prev.index).length
  const lookup: Step<S> = {
    kind: 'hash.index-lookup',
    state: prev,
    narration:
      offset === undefined
        ? `One hash lookup in the in-memory index: ${key} is not there, so the answer is already known — no disk I/O at all.`
        : `One hash lookup in the in-memory index: ${key} lives at byte offset ${offset}. No scanning, no guessing — the index IS the location.`,
    highlights: offset === undefined ? [] : [{ id: indexRowId(key), role: 'active' }],
    metrics: { indexEntries, seeks: 0 },
  }

  if (offset === undefined) {
    const miss: Step<S> = {
      kind: 'hash.read-miss',
      state: prev,
      narration: `${key} is not in the index, so it is not in the file: a miss costs one in-memory lookup and zero disk reads, however long the file is. An unindexed log would have scanned every entry.`,
      why: 'The hash index turns misses into pure RAM work — and its price is that the whole index must fit in RAM.',
      highlights: [],
      metrics: { indexEntries, seeks: 0 },
    }
    return { steps: [lookup, miss], result: prev }
  }

  const entry = prev.file.find((e) => e.offset === offset)
  if (entry === undefined || entry.key !== key) {
    // Defensive: a dangling pointer can only exist in hand-built states.
    const miss: Step<S> = {
      kind: 'hash.read-miss',
      state: prev,
      narration: `The index points ${key} at offset ${offset}, but no matching record sits there — a stale pointer that can only exist in a corrupted index. Reads trust the index, which is why keeping it consistent matters.`,
      highlights: [],
      metrics: { indexEntries, seeks: 0 },
    }
    return { steps: [lookup, miss], result: prev }
  }

  const hit: Step<S> = {
    kind: 'hash.read-hit',
    state: prev,
    narration: `One seek to byte offset ${offset} reads back ${key}=${entry.value}. A point read is O(1): one hash lookup plus one disk seek, no matter how big the file grows.`,
    why: 'This is the payoff of the RAM-for-reads trade: lookups stay constant while the log keeps growing.',
    highlights: [
      { id: indexRowId(key), role: 'hit' },
      { id: entry.id, role: 'hit' },
    ],
    metrics: { indexEntries, seeks: 1, bytesRead: entryBytes(entry) },
  }
  return { steps: [lookup, hit], result: prev }
}

function compact(prev: S): RunResult<S> {
  const dedupe = prev.config.dedupeOnCompact
  const dropped = dedupe ? droppedIds(prev.file) : new Set<string>()
  const plural = (n: number) => `${n} entr${n === 1 ? 'y' : 'ies'}`

  const scan: Step<S> = {
    kind: 'hash.compact-scan',
    state: prev,
    narration: dedupe
      ? `One pass over the file identifies the newest entry per key: ${dropped.size} stale version(s) — plus any tombstoned keys — are marked for dropping.`
      : 'Deduplication is off, so the pass marks nothing for dropping and every entry will be copied as-is.',
    highlights: prev.file.map((e) => ({
      id: e.id,
      role: (dropped.has(e.id) ? 'removed' : 'active') as Highlight['role'],
    })),
    metrics: { entriesIn: prev.file.length, dropped: dropped.size },
  }

  const survivors = prev.file.filter((e) => !dropped.has(e.id))
  const shrunken: S = { ...prev, file: survivors }
  const dropStep: Step<S> = {
    kind: 'hash.compact-drop',
    state: shrunken,
    narration: `The rewrite copies only the ${plural(survivors.length)} that survive; the ${dropped.size} dropped one(s) free their space in the new file. Until the swap, reads keep working through the old index and the old file.`,
    highlights: survivors.map((e) => ({ id: e.id, role: 'active' as const })),
    metrics: { entriesIn: prev.file.length, dropped: dropped.size },
  }

  let offset = 0
  const rewritten: FileEntry[] = survivors.map((e) => {
    const out = { ...e, offset }
    offset += entryBytes(e)
    return out
  })
  const rebuilt: Record<string, number> = {}
  for (const entry of rewritten) rebuilt[entry.key] = entry.offset
  const final: S = { ...prev, file: rewritten, index: rebuilt }

  const rebuild: Step<S> = {
    kind: 'hash.compact-rebuild',
    state: final,
    narration: `Survivors land at fresh byte offsets and the index is rebuilt from the compacted file: ${Object.keys(rebuilt).length} key(s) repointed. The old file can now be deleted and reads keep working unchanged.`,
    why: 'Compaction keeps the file small — but rebuilding the index means reading the whole file once (O(n)), exactly what happens on every restart.',
    highlights: [
      ...rewritten.map((e) => ({ id: e.id, role: 'active' as const })),
      ...Object.keys(rebuilt).map((k) => ({ id: indexRowId(k), role: 'new' as const })),
    ],
    metrics: { entriesOut: rewritten.length, indexEntries: Object.keys(rebuilt).length },
  }
  return { steps: [scan, dropStep, rebuild], result: final }
}
