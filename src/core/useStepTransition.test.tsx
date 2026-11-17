// Tests for the animation convention hook (PLAN.md §3.1):
// - auto-calls onAnimationComplete when there is nothing to animate
//   (identical snapshots, or prefers-reduced-motion) — the player must never
//   hang on a missing callback;
// - auto-calls exactly once per step (no double-advance);
// - scales durations with speed and clamps speed to 0.25–2;
// - does NOT auto-call when snapshots differ (module animates itself).

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BASE_DURATION,
  clampSpeed,
  MAX_SPEED,
  MIN_SPEED,
  statesEqual,
  useStepTransition,
  type UseStepTransitionArgs,
} from './useStepTransition'

const stateA = { memtables: [{ id: 'm1', entries: [{ id: 'e1', key: 'a', value: '1' }] }] }
const stateB = { memtables: [{ id: 'm1', entries: [{ id: 'e1', key: 'a', value: '2' }] }] }

function makeArgs(overrides: Partial<UseStepTransitionArgs> = {}): UseStepTransitionArgs {
  return {
    state: stateA,
    prevState: stateB,
    speed: 1,
    direction: 1,
    reducedMotion: false,
    onAnimationComplete: vi.fn(),
    ...overrides,
  }
}

describe('clampSpeed', () => {
  it('clamps to 0.25–2 and defaults NaN to 1', () => {
    expect(clampSpeed(0.1)).toBe(MIN_SPEED)
    expect(clampSpeed(5)).toBe(MAX_SPEED)
    expect(clampSpeed(1.5)).toBe(1.5)
    expect(clampSpeed(Number.NaN)).toBe(1)
  })
})

describe('statesEqual', () => {
  it('compares JSON-serializable snapshots by value', () => {
    expect(statesEqual(stateA, structuredClone(stateA))).toBe(true)
    expect(statesEqual(stateA, stateB)).toBe(false)
    expect(statesEqual(stateA, undefined)).toBe(false)
  })
})

describe('useStepTransition auto-complete', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('auto-calls onAnimationComplete when snapshots are identical', () => {
    const spy = vi.fn()
    const { result } = renderHook(() =>
      useStepTransition(makeArgs({ state: stateA, prevState: stateA, onAnimationComplete: spy })),
    )
    expect(result.current.nothingToAnimate).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    act(() => {
      vi.runAllTimers()
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('auto-calls exactly once per step, even across re-renders', () => {
    const spy = vi.fn()
    const args = makeArgs({ state: stateA, prevState: stateA, onAnimationComplete: spy })
    const { rerender } = renderHook((a) => useStepTransition(a), { initialProps: args })
    act(() => {
      vi.runAllTimers()
    })
    rerender({ ...args })
    act(() => {
      vi.runAllTimers()
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('auto-calls under reduced motion even when snapshots differ', () => {
    const spy = vi.fn()
    const { result } = renderHook(() =>
      useStepTransition(makeArgs({ reducedMotion: true, onAnimationComplete: spy })),
    )
    expect(result.current.nothingToAnimate).toBe(true)
    expect(result.current.duration).toBe(0)
    act(() => {
      vi.runAllTimers()
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does NOT auto-call when snapshots differ and motion is allowed', () => {
    const spy = vi.fn()
    const { result } = renderHook(() => useStepTransition(makeArgs({ onAnimationComplete: spy })))
    expect(result.current.nothingToAnimate).toBe(false)
    act(() => {
      vi.runAllTimers()
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('does NOT auto-call on the first step (no previous snapshot)', () => {
    const spy = vi.fn()
    const { result } = renderHook(() =>
      useStepTransition(makeArgs({ prevState: undefined, onAnimationComplete: spy })),
    )
    expect(result.current.nothingToAnimate).toBe(false)
    act(() => {
      vi.runAllTimers()
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('clears a pending auto-call when the step changes to an animatable one', () => {
    const spy = vi.fn()
    const { rerender } = renderHook((a) => useStepTransition(a), {
      initialProps: makeArgs({ state: stateA, prevState: stateA, onAnimationComplete: spy }),
    })
    rerender(makeArgs({ state: stateA, prevState: stateB, onAnimationComplete: spy }))
    act(() => {
      vi.runAllTimers()
    })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('useStepTransition speed scaling', () => {
  it('scales duration inversely with speed', () => {
    const { result: at1x } = renderHook(() => useStepTransition(makeArgs({ speed: 1 })))
    const { result: at2x } = renderHook(() => useStepTransition(makeArgs({ speed: 2 })))
    const { result: atQuarter } = renderHook(() => useStepTransition(makeArgs({ speed: 0.25 })))
    expect(at1x.current.duration).toBeCloseTo(BASE_DURATION)
    expect(at2x.current.duration).toBeCloseTo(BASE_DURATION / 2)
    expect(atQuarter.current.duration).toBeCloseTo(BASE_DURATION / 0.25)
  })

  it('clamps out-of-range speeds', () => {
    const { result: fast } = renderHook(() => useStepTransition(makeArgs({ speed: 10 })))
    const { result: slow } = renderHook(() => useStepTransition(makeArgs({ speed: 0.01 })))
    expect(fast.current.speed).toBe(MAX_SPEED)
    expect(slow.current.speed).toBe(MIN_SPEED)
    expect(slow.current.duration).toBeCloseTo(BASE_DURATION / MIN_SPEED)
  })

  it('flips the crossfade shift with direction and zeroes it under reduced motion', () => {
    const { result: fwd } = renderHook(() => useStepTransition(makeArgs({ direction: 1 })))
    const { result: back } = renderHook(() => useStepTransition(makeArgs({ direction: -1 })))
    const { result: reduced } = renderHook(() =>
      useStepTransition(makeArgs({ direction: 1, reducedMotion: true })),
    )
    expect(fwd.current.variants.enter).toMatchObject({ x: [14, 0] })
    expect(back.current.variants.enter).toMatchObject({ x: [-14, 0] })
    expect(reduced.current.variants.enter).not.toHaveProperty('x')
  })
})
