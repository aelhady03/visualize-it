import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { runConformance } from '@core/runConformance'
import appendLogModule from './index'
import { init, run } from './engine'
import { staleIds, type AppendLogState } from './state'

const kinds = (r: { steps: { kind: string }[] }) => r.steps.map((s) => s.kind)

function writeAll(pairs: Array<[string, string]>, state = init()): AppendLogState {
  return pairs.reduce((s, [key, value]) => run('write', { key, value }, s).result, state)
}

describe('append-log conformance', () => {
  it('passes runConformance', async () => {
    const report = await runConformance(appendLogModule)
    expect(report.failures).toEqual([])
    expect(report.passed).toBe(true)
  })
})

describe('write', () => {
  it('emits wal.append then log.index and appends one entry', () => {
    const r = run('write', { key: 'a', value: '1' }, init())
    expect(r.error).toBeUndefined()
    expect(kinds(r)).toEqual(['wal.append', 'log.index'])
    expect(r.result.entries).toEqual([{ id: 'e1', key: 'a', value: '1', seq: 1 }])
    expect(r.result.seq).toBe(2)
  })

  it('an update appends a new version and marks the old one stale', () => {
    const s = writeAll([
      ['a', '1'],
      ['a', '2'],
    ])
    expect(s.entries.map((e) => e.value)).toEqual(['1', '2'])
    expect(staleIds(s.entries)).toEqual(['e1'])
  })

  it('rejects an empty key as invalid input', () => {
    const r = run('write', { key: '  ', value: 'x' }, init())
    expect(r.error).toBeDefined()
    expect(r.steps).toEqual([])
  })
})

describe('read', () => {
  const s = writeAll([
    ['a', '1'],
    ['b', '2'],
    ['c', '3'],
  ])

  it('probes backward from the tail until it hits', () => {
    const r = run('read', { key: 'b' }, s)
    expect(kinds(r)).toEqual(['read.probe', 'read.probe', 'read.hit'])
    expect(r.steps[0].highlights).toEqual([{ id: 'e3', role: 'active' }])
    expect(r.steps.at(-1)!.highlights).toEqual([{ id: 'e2', role: 'hit' }])
    expect(r.result).toEqual(s)
  })

  it('a missing key probes every entry then misses — not an error', () => {
    const r = run('read', { key: 'zzz' }, s)
    expect(r.error).toBeUndefined()
    expect(kinds(r)).toEqual(['read.probe', 'read.probe', 'read.probe', 'read.miss'])
  })

  it('an empty log misses immediately', () => {
    expect(kinds(run('read', { key: 'a' }, init()))).toEqual(['read.miss'])
  })

  it('rejects an empty key', () => {
    expect(run('read', {}, s).error).toBeDefined()
  })
})

describe('compact', () => {
  const s = writeAll([
    ['a', '1'],
    ['b', '2'],
    ['a', '3'],
  ])

  it('emits compact.merge then compact.done and drops stale versions', () => {
    const r = run('compact', undefined, s)
    expect(kinds(r)).toEqual(['compact.merge', 'compact.done'])
    expect(r.result.entries.map((e) => e.id)).toEqual(['e2', 'e3'])
    expect(r.result.seq).toBe(s.seq)
  })

  it('keeps every entry when dedupeOnCompact is off', () => {
    const off = writeAll(
      [
        ['a', '1'],
        ['b', '2'],
        ['a', '3'],
      ],
      init({ dedupeOnCompact: false }),
    )
    const r = run('compact', undefined, off)
    expect(kinds(r)).toEqual(['compact.merge', 'compact.done'])
    expect(r.result.entries).toEqual(off.entries)
  })

  it('a dry run leaves the log unchanged', () => {
    const r = run('compact', { dryRun: true }, s)
    expect(kinds(r)).toEqual(['compact.merge', 'compact.done'])
    expect(r.result).toEqual(s)
  })
})

describe('unknown ops', () => {
  it('are an invalid-input error', () => {
    const r = run('nope', undefined, init())
    expect(r.error).toBeDefined()
    expect(r.steps).toEqual([])
  })
})

describe('property: the log behaves like a Map under any op sequence', () => {
  it('reads match a reference Map before and after compaction', () => {
    const key = fc.constantFrom('a', 'b', 'c', 'd')
    const op = fc.oneof(
      fc.record({ op: fc.constant('write' as const), key, value: fc.string({ maxLength: 3 }) }),
      fc.record({ op: fc.constant('compact' as const) }),
    )
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), fc.boolean(), (ops, dedupe) => {
        let state = init({ dedupeOnCompact: dedupe })
        const ref = new Map<string, string>()
        for (const o of ops) {
          const r =
            o.op === 'write'
              ? run('write', { key: o.key, value: o.value }, state)
              : run('compact', undefined, state)
          expect(r.error).toBeUndefined()
          expect(r.result).toEqual(r.steps.at(-1)!.state)
          if (o.op === 'write') ref.set(o.key, o.value)
          state = r.result
        }
        // seq is strictly increasing along the log; ids are unique.
        const seqs = state.entries.map((e) => e.seq)
        expect([...seqs].sort((x, y) => x - y)).toEqual(seqs)
        expect(new Set(seqs).size).toBe(seqs.length)
        for (const k of ['a', 'b', 'c', 'd']) {
          const r = run('read', { key: k }, state)
          const last = r.steps.at(-1)!
          if (ref.has(k)) {
            expect(last.kind).toBe('read.hit')
            const hitId = last.highlights![0].id
            expect(state.entries.find((e) => e.id === hitId)!.value).toBe(ref.get(k))
          } else {
            expect(last.kind).toBe('read.miss')
          }
        }
        if (dedupe) {
          const compacted = run('compact', undefined, state).result
          expect(staleIds(compacted.entries)).toEqual([])
          expect(compacted.entries.length).toBe(ref.size)
        }
      }),
    )
  })
})
