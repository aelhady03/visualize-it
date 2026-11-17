// ModuleHomePage: renders the module's Intro primer when the module provides
// one, and keeps the placeholder for modules without Intro.
//
// `useModule` is mocked to return the module synchronously: React 19's `use()`
// always suspends once for a native promise, and that retry is not captured by
// the test environment's act cycle. The suspense/loader mechanics themselves
// are covered by the player-store suite and the browser evidence.

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VizModule } from '@core/view-contract'
import { ModuleHomePage } from './ModuleHomePage'

const baseModule: VizModule<unknown> = {
  contractVersion: 1,
  meta: {
    id: 'home-test',
    title: 'Home Test Engine',
    description: 'Testing the home page.',
    topics: ['logs', 'indexes'],
    difficulty: 'beginner',
    category: 'Test',
    order: 0,
  },
  operations: [],
  settings: [],
  scenarios: [],
  engine: {
    init: () => ({}),
    run: () => ({ steps: [], result: {} }),
  },
  Render: () => <svg />,
}

const seam = vi.hoisted(() => ({ modules: {} as Record<string, VizModule<unknown>> }))

vi.mock('./useModule', () => ({
  loadModuleCached: (id: string) => Promise.resolve(seam.modules[id]),
  useModule: (id: string) => {
    const module = seam.modules[id]
    if (!module) throw new Error(`no module ${id}`)
    return module
  },
}))

function renderHome(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/modules/${id}`]}>
      <Routes>
        <Route path="/modules/:id" element={<ModuleHomePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  seam.modules = {}
})

afterEach(cleanup)

describe('ModuleHomePage', () => {
  it('renders the module Intro when the module provides one', () => {
    seam.modules['with-intro'] = {
      ...baseModule,
      Intro: () => <p data-testid="intro">The primer explains this engine.</p>,
    }
    renderHome('with-intro')

    expect(screen.getByTestId('intro')).toBeTruthy()
    expect(screen.getByText('The primer explains this engine.')).toBeTruthy()
    // Meta still renders around it.
    expect(screen.getByText('Home Test Engine')).toBeTruthy()
    expect(screen.getByText('logs')).toBeTruthy()
    expect(screen.queryByText('Introduction coming soon')).toBeNull()
  })

  it('keeps the placeholder for modules without an Intro', () => {
    seam.modules['without-intro'] = { ...baseModule, Intro: undefined }
    renderHome('without-intro')

    expect(screen.getByText('Introduction coming soon')).toBeTruthy()
    expect(screen.getByText(/does not ship an Intro primer yet/)).toBeTruthy()
    expect(screen.queryByTestId('intro')).toBeNull()
  })
})
