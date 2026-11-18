// DiagramPane — mounts the module's Render in the center of the viewer
// (PLAN.md §4), framed as an instrument: a recessed stage with a dot grid,
// a readout strip naming the current step, and the diagram scaled to fit.
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
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { usePlayerStore } from '@core/player/store'
import type { Highlight } from '@core/engine-contract'
import type { RenderProps, VizModule } from '@core/view-contract'
import { diffHighlights } from './diff'

/** Small diagrams are drawn up to this much larger than their natural size. */
const MAX_UPSCALE = 1.5
/** Wide diagrams never shrink below this, so 10px labels stay legible; the stage scrolls instead. */
const MIN_SCALE = 0.85

/**
 * Let the module's root <svg> scale with the stage: give it a viewBox when it
 * only declares width/height, then size it to min(stage, natural × 1.5), but
 * never below natural × 0.85 (the stage scrolls horizontally instead).
 */
function useFitSvg(stage: React.RefObject<HTMLDivElement | null>, key: string) {
  useLayoutEffect(() => {
    const svg = stage.current?.querySelector(':scope > div > svg')
    if (!(svg instanceof SVGSVGElement)) return
    const w = Number(svg.getAttribute('width'))
    const h = Number(svg.getAttribute('height'))
    if (!w || !h) return
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.style.width = `min(100%, ${Math.round(w * MAX_UPSCALE)}px)`
    svg.style.minWidth = `${Math.round(w * MIN_SCALE)}px`
    svg.style.height = 'auto'
  }, [stage, key])
}

export function DiagramPane({ module }: { module: VizModule<unknown> }) {
  const { steps, index, speed, actions } = usePlayerStore()
  const reducedMotion = useReducedMotion() ?? false
  const stageRef = useRef<HTMLDivElement>(null)

  // Initial state for the very first paint, before any run commits.
  const initial = useMemo(() => module.engine.init(), [module])

  // The store uses index -1 when there is no timeline to show.
  const current = steps.length > 0 ? Math.max(0, Math.min(index, steps.length - 1)) : -1
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
  const stepKey = current >= 0 ? `${current}:${step?.kind ?? ''}` : 'initial'
  useFitSvg(stageRef, stepKey)

  return (
    <section aria-label={`${module.meta.title} diagram`} className="flex min-w-0 flex-col">
      <div className="flex min-h-9 items-center justify-between gap-3 px-2 pb-2 text-[0.8125rem] text-ink-soft">
        <span className="voice-printed truncate" aria-live="polite">
          {step ? step.kind : 'initial state'}
        </span>
        <span className="voice-printed shrink-0 tabular-nums">
          {step ? (
            <>
              step <span className="text-ink">{current + 1}</span> of {steps.length}
            </>
          ) : (
            'no run yet'
          )}
        </span>
      </div>

      <div
        ref={stageRef}
        className="viz-stage relative flex min-h-[16rem] items-center justify-center overflow-auto rounded-[7px] p-3 text-viz-text sm:min-h-[22rem] sm:p-6 md:min-h-[26rem]"
      >
        <div key={stepKey} className="flex w-full min-w-fit justify-center">
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
    </section>
  )
}
