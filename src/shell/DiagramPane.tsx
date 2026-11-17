// DiagramPane — mounts the module's Render in the center of the viewer
// (PLAN.md §4).
//
// Feeds the Render the current snapshot from the player store (falling back
// to engine.init() before the first run), the previous snapshot, playback
// direction (derived from index movement), speed, prefers-reduced-motion,
// engine highlights merged with shell diff highlights, and wires the Render's
// onAnimationComplete straight into the store action so the player advances
// only when animations settle (PLAN.md §3.1).
//
// The wrapper is keyed per step so each step remounts and replays entry
// animations.

import { useReducedMotion } from 'motion/react'
import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { usePlayerStore } from '@core/player/store'
import type { Highlight } from '@core/engine-contract'
import type { RenderProps, VizModule } from '@core/view-contract'
import { diffHighlights } from './diff'

export function DiagramPane({ module }: { module: VizModule<unknown> }) {
  const { steps, index, speed, actions } = usePlayerStore()
  const reducedMotion = useReducedMotion() ?? false

  // Initial state for the very first paint, before any run commits.
  const initial = useMemo(() => module.engine.init(), [module])

  const current = steps.length > 0 ? Math.min(index, steps.length - 1) : -1
  const step = current >= 0 ? steps[current] : undefined
  const prevStep = current > 0 ? steps[current - 1] : undefined

  const state = step?.state ?? initial
  const prevState = prevStep?.state

  const highlights = useMemo<Highlight[]>(
    () => diffHighlights(prevState, state, step?.highlights),
    [prevState, state, step?.highlights],
  )

  // Playback direction: derived from index movement (forward / backward) via
  // the documented "store information from previous renders" pattern.
  const [prevIndex, setPrevIndex] = useState(index)
  if (index !== prevIndex) setPrevIndex(index)
  const direction: 1 | -1 = index >= prevIndex ? 1 : -1

  const Render = module.Render as unknown as ComponentType<RenderProps<unknown>>

  return (
    <div
      aria-label={`${module.meta.title} diagram`}
      className="flex min-h-80 items-center justify-center overflow-auto rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div key={current >= 0 ? `${current}:${step?.kind ?? ''}` : 'initial'}>
        <Render
          state={state}
          prevState={prevState}
          direction={direction}
          speed={speed}
          reducedMotion={reducedMotion}
          highlights={highlights}
          onAnimationComplete={() => actions.onAnimationComplete()}
        />
      </div>
    </div>
  )
}
