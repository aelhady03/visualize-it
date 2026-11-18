// Step trace: a plain-language account of what one step changed, derived from
// data the shell already has (no module cooperation needed):
//
// - entity roles: the engine's highlights merged with the shell diff
//   (diffHighlights), grouped by role and named by the entity's key when it
//   has one ("added plum", "found kiwi", "superseded apple");
// - counters: every numeric metric that changed since the previous step
//   ("entriesScanned 1 → 2").
//
// The run log prints this under each step so a reader can trace the run line
// by line, beside the module's own narration.

import type { Highlight, Metrics, Step } from '@core/engine-contract'
import { diffHighlights } from './diff'

export interface TraceLine {
  role: Highlight['role']
  /** What happened, in plain words: "added", "found", ... */
  verb: string
  /** Entity names (key, name or label; the id when nothing better exists). */
  names: string[]
}

export interface CounterChange {
  name: string
  before: number | string | undefined
  after: number | string
}

export interface StepTrace {
  lines: TraceLine[]
  counters: CounterChange[]
}

/** Role → verb, in the order the trace prints them. */
const VERBS: [Highlight['role'], string][] = [
  ['active', 'working on'],
  ['hit', 'found'],
  ['miss', 'not found'],
  ['new', 'added'],
  ['stale', 'superseded'],
  ['removed', 'removed'],
]

/** Index every entity (array item with a string id) in a snapshot by id. */
function indexEntities(value: unknown, into: Map<string, Record<string, unknown>>): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const id = (item as { id?: unknown }).id
        if (typeof id === 'string' && !into.has(id)) into.set(id, item as Record<string, unknown>)
      }
      indexEntities(item, into)
    }
    return
  }
  for (const v of Object.values(value)) indexEntities(v, into)
}

/** The most readable name for an entity: its key, name or label, else its id. */
export function entityName(entity: Record<string, unknown> | undefined, id: string): string {
  for (const field of ['key', 'name', 'label', 'title']) {
    const v = entity?.[field]
    if (typeof v === 'string' && v !== '') {
      return field === 'key' && typeof entity?.seq === 'number' ? `${v} #${entity.seq}` : v
    }
  }
  return id
}

export function traceStep(step: Step<unknown>, prev?: Step<unknown>): StepTrace {
  const highlights = diffHighlights(prev?.state, step.state, step.highlights)
  const now = new Map<string, Record<string, unknown>>()
  const before = new Map<string, Record<string, unknown>>()
  indexEntities(step.state, now)
  if (prev) indexEntities(prev.state, before)

  const lines: TraceLine[] = []
  for (const [role, verb] of VERBS) {
    const names = highlights
      .filter((h) => h.role === role)
      .map((h) => entityName(now.get(h.id) ?? before.get(h.id), h.id))
    const unique = [...new Set(names)]
    if (unique.length > 0) lines.push({ role, verb, names: unique })
  }

  const counters: CounterChange[] = []
  const metrics: Metrics = step.metrics ?? {}
  for (const [name, after] of Object.entries(metrics)) {
    const was = prev?.metrics?.[name]
    if (was !== after) counters.push({ name, before: was, after })
  }

  return { lines, counters }
}
