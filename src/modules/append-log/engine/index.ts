/**
 * append-log engine — pure and deterministic (imports only
 * `@core/engine-contract` and this module's pure files).
 *
 * Operations:
 * - `write`   → `wal.append`, `log.index`
 * - `read`    → `read.probe` × n (newest first), then `read.hit` | `read.miss`
 * - `compact` → `compact.merge`, `compact.done`
 *
 * A read that finds nothing is a normal `read.miss`, never an error; `error`
 * is reserved for invalid input (empty key, unknown op).
 */

import type { Config, OpInput, RunResult, Step } from '@core/engine-contract'
import { resolveConfig, staleIds, type AppendLogState, type LogEntry } from '../state'

type S = AppendLogState

export function init(config?: Config): S {
  return { seq: 1, entries: [], config: resolveConfig(config) }
}

export function run(opId: string, input: OpInput | undefined, prev: S): RunResult<S> {
  switch (opId) {
    case 'write':
      return write(input, prev)
    case 'read':
      return read(input, prev)
    case 'compact':
      return compact(input, prev)
    default:
      return { steps: [], result: prev, error: `unknown op id "${opId}"` }
  }
}

function keyOf(input: OpInput | undefined): string {
  const raw = input?.key
  return raw === undefined ? '' : String(raw).trim()
}

function write(input: OpInput | undefined, prev: S): RunResult<S> {
  const key = keyOf(input)
  if (key === '') return { steps: [], result: prev, error: 'write needs a non-empty key' }
  const value = input?.value === undefined ? '' : String(input.value)

  const entry: LogEntry = { id: `e${prev.seq}`, key, value, seq: prev.seq }
  const next: S = { ...prev, seq: prev.seq + 1, entries: [...prev.entries, entry] }
  const shadowed = prev.entries.filter((e) => e.key === key)

  const append: Step<S> = {
    kind: 'wal.append',
    state: next,
    narration: `${key}=${value} is appended to the end of the log at offset ${next.entries.length - 1}. Appending never seeks or rewrites, which is why it is the fastest possible write.`,
    highlights: [{ id: entry.id, role: 'new' }],
    metrics: { logLength: next.entries.length, bytesRewritten: 0 },
  }
  const index: Step<S> = {
    kind: 'log.index',
    state: next,
    narration:
      shadowed.length > 0
        ? `The new entry is now the newest version of ${key}; the ${shadowed.length} older one(s) stay on disk but are stale. Only the position in the log decides which version wins.`
        : `${key} is now findable: the log's only "index" is position, so a reader scanning from the tail will reach this entry first.`,
    why: 'Stale versions keep taking space until compaction removes them.',
    highlights: [
      { id: entry.id, role: 'active' },
      ...shadowed.map((e) => ({ id: e.id, role: 'removed' as const })),
    ],
    metrics: { logLength: next.entries.length, staleEntries: staleIds(next.entries).length },
  }
  return { steps: [append, index], result: next }
}

function read(input: OpInput | undefined, prev: S): RunResult<S> {
  const key = keyOf(input)
  if (key === '') return { steps: [], result: prev, error: 'read needs a non-empty key' }

  const steps: Step<S>[] = []
  for (let i = prev.entries.length - 1; i >= 0; i -= 1) {
    const entry = prev.entries[i]
    const scanned = prev.entries.length - i
    steps.push({
      kind: 'read.probe',
      state: prev,
      narration: `The reader checks offset ${i} (key ${entry.key}). It scans backward from the tail because the newest write for a key always wins.`,
      highlights: [{ id: entry.id, role: 'active' }],
      metrics: { entriesScanned: scanned },
    })
    if (entry.key === key) {
      steps.push({
        kind: 'read.hit',
        state: prev,
        narration: `Found ${key}=${entry.value} after scanning ${scanned} entr${scanned === 1 ? 'y' : 'ies'}. Without an index, every read costs a scan proportional to how far back the key was written.`,
        why: 'A hash index (Bitcask) removes this scan by remembering each key’s latest offset.',
        highlights: [{ id: entry.id, role: 'hit' }],
        metrics: { entriesScanned: scanned },
      })
      return { steps, result: prev }
    }
  }
  steps.push({
    kind: 'read.miss',
    state: prev,
    narration: `${key} is not in the log, and the reader only knows that after scanning all ${prev.entries.length} entries. A miss is the worst case for an unindexed log.`,
    why: 'Misses cost a full scan, which is why real engines add an index or a Bloom filter.',
    highlights: [],
    metrics: { entriesScanned: prev.entries.length },
  })
  return { steps, result: prev }
}

function compact(input: OpInput | undefined, prev: S): RunResult<S> {
  const dryRun = input?.dryRun === true
  const dedupe = prev.config.dedupeOnCompact
  const stale = dedupe ? new Set(staleIds(prev.entries)) : new Set<string>()

  const merge: Step<S> = {
    kind: 'compact.merge',
    state: prev,
    narration: dedupe
      ? `One pass over the log keeps only the newest version of each key; ${stale.size} stale entr${stale.size === 1 ? 'y is' : 'ies are'} marked for dropping.`
      : 'Deduplication is off, so the pass copies every entry as-is and nothing is marked for dropping.',
    highlights: prev.entries.map((e) => ({
      id: e.id,
      role: stale.has(e.id) ? ('removed' as const) : ('active' as const),
    })),
    metrics: { entriesIn: prev.entries.length, dropped: stale.size },
  }

  const survivors = prev.entries.filter((e) => !stale.has(e.id))
  const next: S = dryRun ? prev : { ...prev, entries: survivors }
  const done: Step<S> = {
    kind: 'compact.done',
    state: next,
    narration: dryRun
      ? `Dry run: compaction would shrink the log from ${prev.entries.length} to ${survivors.length} entries, but the log is left untouched.`
      : `The compacted log replaces the old one with ${survivors.length} entr${survivors.length === 1 ? 'y' : 'ies'}, reclaiming ${stale.size}. Reads still see the same latest values, just with less to scan.`,
    highlights: survivors.map((e) => ({ id: e.id, role: 'new' as const })),
    metrics: { entriesIn: prev.entries.length, entriesOut: survivors.length },
  }
  return { steps: [merge, done], result: next }
}
