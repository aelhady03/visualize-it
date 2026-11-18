import { describe, expect, it } from 'vitest'
import type { Step } from '@core/engine-contract'
import { entityName, traceStep } from './trace'

const step = (state: unknown, extra: Partial<Step<unknown>> = {}): Step<unknown> => ({
  kind: 'x.y',
  narration: 'n',
  state,
  ...extra,
})

describe('traceStep', () => {
  it('names added and removed entities by key, grouped by role', () => {
    const prev = step({ entries: [{ id: 'e1', key: 'apple', seq: 1 }, { id: 'e2', key: 'kiwi', seq: 2 }] })
    const next = step(
      { entries: [{ id: 'e1', key: 'apple', seq: 1 }, { id: 'e3', key: 'plum', seq: 3 }] },
      { highlights: [{ id: 'e1', role: 'hit' }] },
    )
    const { lines } = traceStep(next, prev)
    expect(lines).toEqual([
      { role: 'hit', verb: 'found', names: ['apple #1'] },
      { role: 'new', verb: 'added', names: ['plum #3'] },
      { role: 'removed', verb: 'removed', names: ['kiwi #2'] },
    ])
  })

  it('lists counters that changed since the previous step', () => {
    const prev = step({}, { metrics: { scanned: 1, bytes: 0 } })
    const next = step({}, { metrics: { scanned: 2, bytes: 0 } })
    expect(traceStep(next, prev).counters).toEqual([{ name: 'scanned', before: 1, after: 2 }])
  })

  it('falls back to the id when an entity has no readable name', () => {
    expect(entityName({ id: 's1' }, 's1')).toBe('s1')
    expect(entityName({ id: 's1', name: 'sst-0001' }, 's1')).toBe('sst-0001')
  })
})
