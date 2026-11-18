// Smoke tests for the shell components against an EMPTY player store and
// mocked discovery (zero modules): every component renders gracefully when
// moduleId is null / steps is empty, and diff highlighting marks entities by
// id.

import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Operation, SettingSpec } from '@core/engine-contract'
import type { VizModule } from '@core/view-contract'
import { collectEntityIds, diffHighlights } from './diff'
import { DiagramPane, NarrationPanel, OperationBar, Sidebar, StepperControls } from './index'

// --- Seam mocks: stable regardless of lane A's implementation details --------
// Mirrors the real PlayerStore interface (src/core/player/store.ts).

const seam = vi.hoisted(() => ({
  store: {
    moduleId: 'sstable' as string | null,
    mode: 'guided' as 'guided' | 'sandbox',
    run: null as { opId: string; input?: Record<string, string | number | boolean> } | { scenarioId: string } | null,
    steps: [] as { kind: string; state: unknown; narration: string }[],
    chapters: [] as { start: number; end: number; label: string }[],
    index: -1,
    speed: 1,
    playing: false,
    historyLength: 0,
    actions: {
      startRun: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stepForward: vi.fn(),
      stepBack: vi.fn(),
      scrubTo: vi.fn(),
      setSpeed: vi.fn(),
      fastForwardChapter: vi.fn(),
      undo: vi.fn(),
      reset: vi.fn(),
      onAnimationComplete: vi.fn(),
    },
  },
}))

vi.mock('@core/player/store', () => ({
  usePlayerStore: () => seam.store,
}))

// Pre-sorted the way getModules() returns: by category, then meta.order.
const SUMMARIES = [
  {
    meta: {
      id: 'append-log',
      title: 'Append-Only Log',
      description: 'The simplest engine.',
      topics: ['logs'],
      difficulty: 'beginner' as const,
      category: 'Storage Engines',
      order: 0,
    },
    operations: [] as Operation[],
    settings: [] as SettingSpec[],
  },
  {
    meta: {
      id: 'sstable',
      title: 'SSTable / LSM-Tree',
      description: 'Write, read, compact.',
      topics: ['LSM', 'bloom filters'],
      difficulty: 'intermediate' as const,
      category: 'Storage Engines',
      order: 1,
    },
    operations: [] as Operation[],
    settings: [] as SettingSpec[],
  },
  {
    meta: {
      id: 'hash-index',
      title: 'Hash Index',
      description: 'Key → offset.',
      topics: ['indexes'],
      difficulty: 'beginner' as const,
      category: 'Indexes',
      order: 0,
    },
    operations: [] as Operation[],
    settings: [] as SettingSpec[],
  },
]

vi.mock('@core/discovery', () => ({
  getModules: vi.fn(() => SUMMARIES),
  loadModule: vi.fn(() => Promise.reject(new Error('no module in smoke test'))),
}))

// --- Fixtures -----------------------------------------------------------------

const OPERATIONS: Operation[] = [
  { id: 'write', label: 'Write', description: 'Insert a key', mode: 'both', inputSchema: [{ id: 'key', label: 'Key', type: 'text' }] },
  { id: 'compact', label: 'Compact', description: 'Merge files', mode: 'guided' },
]

const SETTINGS: SettingSpec[] = [
  { id: 'strategy', label: 'Strategy', type: 'select', options: ['stcs', 'leveled'], default: 'stcs' },
]

const MODULE: VizModule<unknown> = {
  contractVersion: 1,
  meta: {
    id: 'sstable',
    title: 'SSTable / LSM-Tree',
    description: 'Write, read, compact.',
    topics: ['LSM'],
    difficulty: 'intermediate',
    category: 'Storage Engines',
    order: 1,
  },
  operations: OPERATIONS,
  settings: SETTINGS,
  scenarios: [],
  engine: {
    init: () => ({ memtables: [], config: {} }),
    run: () => ({ steps: [], result: { memtables: [], config: {} } }),
  },
  Render: () => <svg data-testid="module-render" />,
}

function withRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  seam.store.mode = 'guided'
})

afterEach(cleanup)

// --- diff highlighting ---------------------------------------------------------

describe('diffHighlights', () => {
  const prevState = {
    memtables: [{ id: 'm1', entries: [{ id: 'e1', key: 'a' }, { id: 'e2', key: 'b' }] }],
    config: { memtableCap: 6 },
  }
  const nextState = {
    memtables: [{ id: 'm1', entries: [{ id: 'e1', key: 'a' }] }],
    l0: [{ id: 's1', blocks: [{ id: 'b1', entries: [{ id: 'e2', key: 'b' }] }] }],
    config: { memtableCap: 6 },
  }

  it('marks added entities new and missing entities removed, by id', () => {
    const highlights = diffHighlights(prevState, nextState)
    expect(highlights).toEqual(
      expect.arrayContaining([
        { id: 's1', role: 'new' },
        { id: 'b1', role: 'new' },
      ]),
    )
    // e2 moved from memtable to a file: still present → no highlight
    expect(highlights).not.toContainEqual({ id: 'e2', role: 'new' })
    expect(highlights).not.toContainEqual({ id: 'e2', role: 'removed' })
    // config/metrics-style plain objects are not treated as entities
    expect(highlights).not.toContainEqual({ id: 'memtableCap', role: 'removed' })
  })

  it('marks ids that disappear entirely as removed', () => {
    const highlights = diffHighlights(nextState, prevState)
    expect(highlights).toEqual(expect.arrayContaining([{ id: 's1', role: 'removed' }]))
  })

  it('keeps engine highlights and skips the diff on the first step', () => {
    const engine: Parameters<typeof diffHighlights>[2] = [{ id: 'e1', role: 'hit' }]
    expect(diffHighlights(undefined, nextState, engine)).toEqual([{ id: 'e1', role: 'hit' }])
    expect(diffHighlights(prevState, nextState, engine)).toEqual(
      expect.arrayContaining([
        { id: 'e1', role: 'hit' },
        { id: 's1', role: 'new' },
      ]),
    )
  })

  it('collectEntityIds gathers nested ids and dedupes repeated ones', () => {
    const ids = new Set<string>()
    collectEntityIds({ entries: [{ id: 'e1' }, { id: 'e1' }], wal: [{ id: 'w1' }] }, ids)
    expect([...ids].sort()).toEqual(['e1', 'w1'])
  })
})

// --- components ----------------------------------------------------------------

describe('Sidebar', () => {
  it('groups modules by category, ordered by meta.order', () => {
    const { container } = withRouter(<Sidebar />)
    const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual(['Storage Engines', 'Indexes'])

    // Within "Storage Engines", append-log (order 0) precedes sstable (order 1).
    const storageGroup = container.querySelector('section h2 + ul')!
    const titles = [...storageGroup.querySelectorAll('a')].map((a) => a.textContent)
    expect(titles?.[0]).toContain('Append-Only Log')
    expect(titles?.[1]).toContain('SSTable')
  })

  it('links each module to its home route', () => {
    withRouter(<Sidebar />)
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(
      expect.arrayContaining(['/modules/sstable', '/modules/append-log', '/modules/hash-index']),
    )
  })
})

describe('OperationBar', () => {
  it('renders operation buttons, the mode toggle and settings controls with an empty store', () => {
    withRouter(
      <OperationBar moduleId="sstable" operations={OPERATIONS} settings={SETTINGS} scenarios={[]} />,
    )
    expect(screen.getByRole('button', { name: 'Write' })).toBeTruthy()
    // 'Compact' is guided-only with no scenario: rendered but disabled.
    expect((screen.getByRole('button', { name: 'Compact' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Guided' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sandbox' })).toBeTruthy()
    expect(screen.getByLabelText('Strategy')).toBeTruthy()
  })

  it('reveals the sandbox form for an operation that needs input in sandbox mode', () => {
    withRouter(
      <OperationBar moduleId="sstable" operations={OPERATIONS} settings={SETTINGS} scenarios={[]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    // "Write" is mode 'both' and the (empty) store is in guided mode: no form.
    expect(screen.queryByLabelText(/Key/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sandbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    expect(screen.getByLabelText(/Key/)).toBeTruthy()
  })

  it('starts a sandbox run with the collected input on submit', () => {
    withRouter(
      <OperationBar moduleId="sstable" operations={OPERATIONS} settings={SETTINGS} scenarios={[]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sandbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    fireEvent.change(screen.getByLabelText(/Key/), { target: { value: 'alpha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run write' }))
    expect(seam.store.actions.startRun).toHaveBeenCalledWith('sstable', 'sandbox', {
      opId: 'write',
      input: { key: 'alpha' },
    })
  })

  it('starts the guided scenario mapped to an operation', () => {
    withRouter(
      <OperationBar
        moduleId="sstable"
        operations={OPERATIONS}
        settings={SETTINGS}
        scenarios={[
          { id: 'compact-story', title: 'Compact', description: '', ops: [{ opId: 'compact' }] },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(seam.store.actions.startRun).toHaveBeenCalledWith('sstable', 'guided', {
      scenarioId: 'compact-story',
    })
  })
})

describe('NarrationPanel', () => {
  it('renders a friendly placeholder when there is no run yet', () => {
    withRouter(<NarrationPanel />)
    expect(screen.getByText(/Run an operation/)).toBeTruthy()
  })
})

describe('StepperControls', () => {
  it('renders with every transport control disabled on an empty timeline', () => {
    withRouter(<StepperControls />)
    const buttons = ['Step back', 'Play', 'Step forward', 'Fast-forward to next chapter', 'Undo last run', 'Reset to initial state']
    for (const name of buttons) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByLabelText('Playback speed')).toBeTruthy()
  })
})

describe('DiagramPane', () => {
  it('mounts the module Render with the initial state when steps are empty', () => {
    withRouter(<DiagramPane module={MODULE} />)
    expect(screen.getByTestId('module-render')).toBeTruthy()
  })
})
