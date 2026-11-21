import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { runConformance } from '@core/runConformance'
import hashIndexModule from './index'
import { init, run } from './engine'
import { droppedIds, indexInvariant, staleIds, type FileEntry, type HashIndexState } from './state'

const kinds = (r: { steps: { kind: string }[] }) => r.steps.map((s) => s.kind)

function writeAll(pairs: Array<[string, string]>, state = init()): HashIndexState {
  return pairs.reduce((s, [key, value]) => run('write', { key, value }, s).result, state)
}

/** Hand-built file entries (for tombstone tests); offsets passed explicitly. */
function entry(id: string, key: string, value: string, seq: number, offset: number): FileEntry {
  return { id, key, value, seq, offset }
}

describe('hash-index conformance', () => {
  it('passes runConformance', async () => {
    const report = await runConformance(hashIndexModule)
    expect(report.failures).toEqual([])
    expect(report.passed).toBe(true)
  })
})

describe('write', () => {
  it('emits hash.write-append then hash.index-set, appends and indexes', () => {
    const r = run('write', { key: 'a', value: '1' }, init())
    expect(r.error).toBeUndefined()
    expect(kinds(r)).toEqual(['hash.write-append', 'hash.index-set'])
    expect(r.result.file).toEqual([{ id: 'e1', key: 'a', value: '1', seq: 1, offset: 0 }])
    expect(r.result.index).toEqual({ a: 0 })
    expect(r.result.seq).toBe(2)
    expect(indexInvariant(r.result)).toBe(true)
  })

  it('places each new record after the previous one, with byte-sized offsets', () => {
    const s = writeAll([
      ['a', '1'],
      ['b', '22'],
    ])
    expect(s.file.map((e) => e.offset)).toEqual([0, 18])
    expect(s.index).toEqual({ a: 0, b: 18 })
  })

  it('an update repoints the index and marks the old version stale', () => {
    const before = writeAll([['a', '1']])
    const r = run('write', { key: 'a', value: '2' }, before)
    expect(kinds(r)).toEqual(['hash.write-append', 'hash.index-set'])
    expect(r.result.index).toEqual({ a: 18 })
    expect(r.result.file.map((e) => e.value)).toEqual(['1', '2'])
    expect(staleIds(r.result.file)).toEqual(['e1'])
    expect(r.steps[1].highlights).toEqual([
      { id: 'e2', role: 'active' },
      { id: 'idx:a', role: 'new' },
      { id: 'e1', role: 'stale' },
    ])
    expect(indexInvariant(r.result)).toBe(true)
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

  it('looks up the index once and hits with one seek', () => {
    const r = run('read', { key: 'b' }, s)
    expect(kinds(r)).toEqual(['hash.index-lookup', 'hash.read-hit'])
    expect(r.steps[0].highlights).toEqual([{ id: 'idx:b', role: 'active' }])
    expect(r.steps[1].highlights).toEqual([
      { id: 'idx:b', role: 'hit' },
      { id: 'e2', role: 'hit' },
    ])
    expect(r.steps[1].metrics).toMatchObject({ seeks: 1 })
    expect(r.result).toEqual(s)
  })

  it('a missing key misses after the lookup — zero disk I/O, not an error', () => {
    const r = run('read', { key: 'zzz' }, s)
    expect(r.error).toBeUndefined()
    expect(kinds(r)).toEqual(['hash.index-lookup', 'hash.read-miss'])
    expect(r.steps[1].metrics).toMatchObject({ seeks: 0 })
  })

  it('an empty index misses immediately', () => {
    expect(kinds(run('read', { key: 'a' }, init()))).toEqual([
      'hash.index-lookup',
      'hash.read-miss',
    ])
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

  it('emits scan, drop and rebuild; stale versions drop, offsets and index rebuild', () => {
    const r = run('compact', undefined, s)
    expect(kinds(r)).toEqual(['hash.compact-scan', 'hash.compact-drop', 'hash.compact-rebuild'])
    expect(r.steps[0].highlights).toEqual([
      { id: 'e1', role: 'removed' },
      { id: 'e2', role: 'active' },
      { id: 'e3', role: 'active' },
    ])
    expect(r.result.file).toEqual([
      { id: 'e2', key: 'b', value: '2', seq: 2, offset: 0 },
      { id: 'e3', key: 'a', value: '3', seq: 3, offset: 18 },
    ])
    expect(r.result.index).toEqual({ b: 0, a: 18 })
    expect(r.result.seq).toBe(s.seq)
    expect(indexInvariant(r.result)).toBe(true)
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
    expect(kinds(r)).toEqual(['hash.compact-scan', 'hash.compact-drop', 'hash.compact-rebuild'])
    expect(r.result.file.map((e) => e.id)).toEqual(off.file.map((e) => e.id))
    // Nothing is dropped, so offsets stay put and the index still points at the newest version.
    expect(r.result.index).toEqual({ a: 36, b: 18 })
    expect(indexInvariant(r.result)).toBe(true)
  })

  it('drops every version of a tombstoned key (tombstone GC)', () => {
    const seeded: HashIndexState = {
      seq: 4,
      file: [
        entry('e1', 'a', '1', 1, 0),
        entry('e2', 'b', '2', 2, 18),
        { ...entry('e3', 'a', '', 3, 36), tombstone: true },
      ],
      index: { a: 36, b: 18 },
      config: { dedupeOnCompact: true },
    }
    expect(droppedIds(seeded.file)).toEqual(new Set(['e1', 'e3']))
    const r = run('compact', undefined, seeded)
    expect(r.error).toBeUndefined()
    expect(r.result.file.map((e) => e.id)).toEqual(['e2'])
    expect(r.result.index).toEqual({ b: 0 })
    expect(indexInvariant(r.result)).toBe(true)
  })

  it('compacting an already-compact file emits all three steps and changes nothing', () => {
    const clean = writeAll([
      ['a', '1'],
      ['b', '2'],
    ])
    const r = run('compact', undefined, clean)
    expect(kinds(r)).toEqual(['hash.compact-scan', 'hash.compact-drop', 'hash.compact-rebuild'])
    expect(r.result).toEqual(clean)
  })

  it('reads still match after compaction', () => {
    const r = run('compact', undefined, s)
    const hit = run('read', { key: 'a' }, r.result)
    expect(hit.steps.at(-1)!.kind).toBe('hash.read-hit')
    expect(r.result.file.find((e) => e.id === 'e3')!.offset).toBe(18)
  })
})

describe('unknown ops', () => {
  it('are an invalid-input error', () => {
    const r = run('nope', undefined, init())
    expect(r.error).toBeDefined()
    expect(r.steps).toEqual([])
  })
})

describe('property: the hash index behaves like a reference Map under any op sequence', () => {
  it('reads match, and the index always points at the newest offset', () => {
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
          // Committed-state invariants.
          expect(indexInvariant(state)).toBe(true)
          const seqs = state.file.map((e) => e.seq)
          expect([...seqs].sort((x, y) => x - y)).toEqual(seqs)
          expect(new Set(seqs).size).toBe(seqs.length)
          const offsets = state.file.map((e) => e.offset)
          expect([...offsets].sort((x, y) => x - y)).toEqual(offsets)
        }
        // Every read matches the reference Map — hit with the right value, or miss.
        for (const k of ['a', 'b', 'c', 'd', 'zzz']) {
          const r = run('read', { key: k }, state)
          const last = r.steps.at(-1)!
          if (ref.has(k)) {
            expect(last.kind).toBe('hash.read-hit')
            const entry = state.file.find((e) => e.offset === state.index[k])
            expect(entry?.key).toBe(k)
            expect(entry?.value).toBe(ref.get(k))
          } else {
            expect(last.kind).toBe('hash.read-miss')
          }
        }
        // A deduping compaction leaves at most one entry per key.
        if (dedupe) {
          const compacted = run('compact', undefined, state).result
          expect(new Set(compacted.file.map((e) => e.key)).size).toBe(compacted.file.length)
          expect(indexInvariant(compacted)).toBe(true)
        }
      }),
    )
  })
})
