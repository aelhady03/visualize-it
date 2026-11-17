// useStepTransition — the shared animation convention hook (PLAN.md §3.1).
//
// Modules call this inside their Render with the current state snapshot, the
// previous snapshot, the player speed and the reduced-motion flag. It returns
// motion `variants` + `transition` already scaled by speed, so entry/exit
// animations feel consistent across every module.
//
// CRITICAL: when there is NOTHING to animate — the states are identical or
// prefers-reduced-motion is on — the hook auto-calls `onAnimationComplete()`
// after the effect (deferred one macrotask, so motion has rendered first).
// This is what guarantees the player can never hang on a missing callback
// (PLAN.md §3.1). When there IS something to animate, the module is
// responsible for calling `onAnimationComplete` from motion's
// `onAnimationComplete` (never additionally — it would double-advance).

import { useEffect, useRef } from 'react'
import type { TargetAndTransition, Transition } from 'motion/react'

export const MIN_SPEED = 0.25
export const MAX_SPEED = 2
/** Entry animation duration in seconds at 1x speed. */
export const BASE_DURATION = 0.45
/** Horizontal crossfade shift in px for non-reduced motion. */
export const SHIFT_PX = 14

export function clampSpeed(speed: number): number {
  if (Number.isNaN(speed)) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

/** Deep equality for JSON-serializable snapshots (PLAN.md §3.1: S is plain JSON). */
export function statesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export interface UseStepTransitionArgs {
  /** Current step's state snapshot. */
  state: unknown
  /** Previous step's state snapshot (undefined on the first step). */
  prevState?: unknown
  /** Player speed; clamped to 0.25–2. */
  speed?: number
  /** Playback direction: 1 = forward, -1 = backward (crossfade slides). */
  direction?: 1 | -1
  /** prefers-reduced-motion: highlights only, no translation. */
  reducedMotion?: boolean
  /** Player completion callback. */
  onAnimationComplete: () => void
}

export interface StepTransition {
  /** Entry animation duration in seconds (already speed-scaled). */
  duration: number
  /** Exit animation duration in seconds. */
  exitDuration: number
  /** motion `transition` for the entry animation. */
  transition: Transition
  /** motion variants: pass to `<motion.g variants={variants} initial="enter" animate="enter">`. */
  variants: { enter: TargetAndTransition; exit: TargetAndTransition }
  /** True when the hook auto-calls onAnimationComplete (nothing to animate). */
  nothingToAnimate: boolean
  /** The clamped speed the durations were computed from. */
  speed: number
}

export function useStepTransition({
  state,
  prevState,
  speed = 1,
  direction = 1,
  reducedMotion = false,
  onAnimationComplete,
}: UseStepTransitionArgs): StepTransition {
  const speedClamped = clampSpeed(speed)
  const duration = reducedMotion ? 0 : BASE_DURATION / speedClamped

  // Nothing to animate: reduced motion, or the snapshot did not change.
  const nothingToAnimate = reducedMotion || (prevState !== undefined && statesEqual(prevState, state))

  // Latest callback without re-running the auto-complete effect.
  const completeRef = useRef(onAnimationComplete)
  useEffect(() => {
    completeRef.current = onAnimationComplete
  })

  // A stable key for "this exact step transition".
  const stepKey = nothingToAnimate ? JSON.stringify(state) : null
  const settledFor = useRef<string | null>(null)

  useEffect(() => {
    if (!nothingToAnimate || stepKey === null) {
      // A real animation is expected: let the module's own onAnimationComplete fire.
      settledFor.current = null
      return
    }
    if (settledFor.current === stepKey) return // already auto-completed this step
    const timer = setTimeout(() => {
      settledFor.current = stepKey
      completeRef.current()
    }, 0)
    return () => clearTimeout(timer)
  }, [nothingToAnimate, stepKey])

  const shift = reducedMotion ? 0 : SHIFT_PX * direction
  const variants: { enter: TargetAndTransition; exit: TargetAndTransition } = {
    enter: reducedMotion
      ? { opacity: [0, 1] }
      : { opacity: [0, 1], x: [shift, 0] },
    exit: reducedMotion ? { opacity: 1 } : { opacity: [1, 0], x: [0, -shift * 0.6] },
  }

  return {
    duration,
    exitDuration: reducedMotion ? 0 : (BASE_DURATION / speedClamped) * 0.6,
    transition: { duration, ease: 'easeOut' },
    variants,
    nothingToAnimate,
    speed: speedClamped,
  }
}
