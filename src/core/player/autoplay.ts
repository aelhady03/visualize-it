/**
 * Autoplay pacing engine for the player (PLAN.md §3.3).
 *
 * Autoplay advances to the next step only after two conditions are met:
 *
 * 1. **Animation complete** — the module's `Render` called `onAnimationComplete()`.
 * 2. **Reading time** — a delay proportional to the step's narration length
 *    (`readingMs`), so the learner can read before the next step.
 *
 * Both delays scale with `1 / speed`, and a **hard timeout** of
 * `HARD_TIMEOUT_MS / speed` advances anyway if the animation-complete callback
 * never arrives (autoplay must never hang, PLAN.md §3.1 fallback).
 *
 * The engine is deliberately UI-free: the store owns the timers per module
 * through one `AutoplayEngine` instance and feeds it steps.
 */

import type { Step } from '../engine-contract'

/** Hard timeout for the animation wait, at 1× speed (PLAN.md §3.1: ~2s ÷ speed). */
export const HARD_TIMEOUT_MS = 2000

/** Reading-time floor/ceiling, before dividing by speed. */
export const MIN_READING_MS = 1500
export const MAX_READING_MS = 8000

/** Per-word reading rate used for the narration-length-proportional delay. */
export const MS_PER_WORD = 260

/**
 * Reading time for one narration, at 1× speed: proportional to the word count,
 * clamped so short narrations still pause briefly and long ones cap out.
 */
export function readingMs(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length
  return Math.min(MAX_READING_MS, Math.max(MIN_READING_MS, 1200 + words * MS_PER_WORD))
}

/**
 * Steps the player should pause at during autoplay (PLAN.md §3.3): key kinds
 * are flushes, compactions, tombstone hits and bloom false positives.
 */
export function isKeyKind(kind: string): boolean {
  return (
    kind.startsWith('flush') ||
    kind.startsWith('compact') ||
    kind.includes('tombstone') ||
    kind.includes('bloom')
  )
}

/**
 * Imperative autoplay state machine for one module. The store creates one per
 * module and drives it from its actions:
 *
 * - `enter`   — a new step is shown while playing: wait for animation-complete
 *               with the hard timeout as fallback.
 * - `complete`— the Render called `onAnimationComplete()`: if playing, start the
 *               reading timer; if paused, remember that the animation finished.
 * - `resume`  — playback (re)starts on the current step: continue the reading
 *               timer or re-arm the animation wait.
 * - `stop`    — pause: cancel timers, but remember the reading/animation state.
 * - `cancel`  — a new run / undo / reset / module switch: forget everything.
 */
export class AutoplayEngine {
  private hardTimer: ReturnType<typeof setTimeout> | null = null
  private readTimer: ReturnType<typeof setTimeout> | null = null
  private awaitingAnimation = false
  private reading = false
  private animationDone = false
  private readonly advance: () => void

  constructor(advance: () => void) {
    this.advance = advance
  }

  /** Enter a new step while playing. */
  enter(_step: Step<unknown>, speed: number): void {
    this.clearTimers()
    this.awaitingAnimation = true
    this.reading = false
    this.animationDone = false
    this.hardTimer = setTimeout(this.advance, HARD_TIMEOUT_MS / speed)
  }

  /** `onAnimationComplete` from the Render for the current step. */
  complete(step: Step<unknown>, speed: number): void {
    if (this.awaitingAnimation) {
      this.clearTimers()
      this.awaitingAnimation = false
      this.reading = true
      this.readTimer = setTimeout(this.advance, readingMs(step.narration) / speed)
    } else {
      // Paused: remember so a later resume() skips straight to the reading timer.
      this.animationDone = true
    }
  }

  /** (Re)start playback on the current step. */
  resume(step: Step<unknown>, speed: number): void {
    this.clearTimers()
    if (this.reading || this.animationDone) {
      this.reading = false
      this.animationDone = false
      this.readTimer = setTimeout(this.advance, readingMs(step.narration) / speed)
    } else {
      this.awaitingAnimation = true
      this.hardTimer = setTimeout(this.advance, HARD_TIMEOUT_MS / speed)
    }
  }

  /** Pause: cancel pending timers but keep the reading/animation state. */
  stop(): void {
    this.clearTimers()
    this.awaitingAnimation = false
  }

  /** Forget all state (new run, undo, reset, module switch). */
  cancel(): void {
    this.clearTimers()
    this.awaitingAnimation = false
    this.reading = false
    this.animationDone = false
  }

  private clearTimers(): void {
    if (this.hardTimer !== null) {
      clearTimeout(this.hardTimer)
      this.hardTimer = null
    }
    if (this.readTimer !== null) {
      clearTimeout(this.readTimer)
      this.readTimer = null
    }
  }
}
