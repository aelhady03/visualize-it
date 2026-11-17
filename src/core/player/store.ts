/**
 * Player store (PLAN.md §3.3) — the shared timeline/stepper state, keyed by
 * module id so each module's sandbox survives switching modules.
 *
 * A **run** is one sandbox operation OR one guided scenario. Steps from all of
 * a scenario's chained ops concatenate into ONE timeline; operation boundaries
 * become **chapter markers**, derived purely from `step.kind` prefixes
 * (`deriveChapters`). The store never imports any module: it resolves them
 * through `@core/discovery` (`loadModule`), so it stays generic over
 * `Step<unknown>`.
 *
 * Semantics (documented for the shell lane):
 * - **Guided** startRun lands on `index 0` (manual stepping is the default).
 * - **Sandbox** startRun commits the op immediately: `historyLength` grows,
 *   `index` lands on the last step (the committed result), playback is a view
 *   over history, `undo` pops one commit, `reset` returns to `engine.init()`.
 * - An invalid-input `error` in sandbox commits nothing and leaves the view.
 * - Autoplay advances only after `onAnimationComplete()` plus a
 *   narration-length reading time, pauses at key kinds (`isKeyKind`), and can
 *   never hang (hard timeout, see `player/autoplay.ts`).
 * - `index` is `-1` when there is no timeline to show; `steps.length > 0`
 *   implies `0 <= index <= steps.length - 1`.
 */

import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import type { OpInput, Step } from '../engine-contract'
import type { VizModule } from '../view-contract'
import { loadModule } from '../discovery'
import { AutoplayEngine, isKeyKind } from './autoplay'

/** A chapter is a run of steps whose `kind` shares the same first segment. */
export interface Chapter {
  start: number
  end: number
  label: string
}

export interface PlayerStore {
  /** Currently selected module, or null before any `startRun`. */
  moduleId: string | null
  mode: 'guided' | 'sandbox'
  /** The active run descriptor: one sandbox op or one guided scenario. */
  run: { opId: string; input?: OpInput } | { scenarioId: string } | null
  /** Full timeline of the active run (guided scenarios concatenate all ops). */
  steps: Step<unknown>[]
  /** Chapter markers over `steps`, derived from `step.kind` prefixes. */
  chapters: Chapter[]
  /** Current step index; -1 when there is no run to show. */
  index: number
  /** Playback speed, clamped to 0.25–2. */
  speed: number
  /** Autoplay is armed (see `player/autoplay.ts` for the pacing rules). */
  playing: boolean
  /** Sandbox: number of committed runs (the undo stack depth). */
  historyLength: number
  actions: {
    startRun(moduleId: string, mode: 'guided' | 'sandbox', run: PlayerStore['run']): void
    play(): void
    pause(): void
    stepForward(): void
    stepBack(): void
    scrubTo(index: number): void
    setSpeed(speed: number): void
    /** Jump to the next chapter's start (or the end of the timeline). */
    fastForwardChapter(): void
    /** Sandbox: pop the last committed run. No-op in guided mode. */
    undo(): void
    /** Return to `engine.init()`: clear the run, history and timeline. */
    reset(): void
    /** The Render reports its animation settled; autoplay advances only after this. */
    onAnimationComplete(): void
  }
}

export type Mode = PlayerStore['mode']
export type RunDescriptor = PlayerStore['run']

/** Per-module state kept across module switches (non-reactive, closure map). */
interface SliceState {
  mode: Mode
  run: RunDescriptor
  steps: Step<unknown>[]
  chapters: Chapter[]
  index: number
  speed: number
  playing: boolean
  historyLength: number
  /** Sandbox: committed engine state the next op runs on. */
  sandboxState: unknown
  /** Sandbox: committed runs, newest last. */
  history: Array<{ run: Exclude<RunDescriptor, null>; steps: Step<unknown>[]; result: unknown }>
}

export const MIN_SPEED = 0.25
export const MAX_SPEED = 2

function clampSpeed(speed: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

/**
 * Derive chapters from step kinds: split each `kind` on the first `.`; steps
 * with consecutive equal prefixes form one chapter labelled by that prefix.
 */
export function deriveChapters(steps: Step<unknown>[]): Chapter[] {
  const chapters: Chapter[] = []
  for (let i = 0; i < steps.length; i += 1) {
    const label = steps[i].kind.split('.')[0]
    const last = chapters.at(-1)
    if (last && last.label === label) {
      last.end = i
    } else {
      chapters.push({ start: i, end: i, label })
    }
  }
  return chapters
}

function emptySlice(): SliceState {
  return {
    mode: 'guided',
    run: null,
    steps: [],
    chapters: [],
    index: -1,
    speed: 1,
    playing: false,
    historyLength: 0,
    sandboxState: undefined,
    history: [],
  }
}

type ResolveModule = (id: string) => Promise<VizModule<unknown>>

/**
 * Create a player store. `resolveModule` defaults to `@core/discovery`'s lazy
 * loader; tests inject their own fake modules. The default instance is
 * exported as `usePlayerStore`.
 */
export function createPlayerStore(
  resolveModule: ResolveModule = loadModule,
): UseBoundStore<StoreApi<PlayerStore>> {
  const slices = new Map<string, SliceState>()
  const engines = new Map<string, AutoplayEngine>()
  const initStates = new Map<string, unknown>()

  return create<PlayerStore>()((set, get) => {
    const ensureSlice = (moduleId: string): SliceState => {
      let slice = slices.get(moduleId)
      if (!slice) {
        slice = emptySlice()
        slices.set(moduleId, slice)
      }
      return slice
    }

    /** Mirror a module's slice into the public state, only while it is active. */
    const syncPublic = (moduleId: string): void => {
      if (!slices.has(moduleId) || get().moduleId !== moduleId) return
      switchPublic(moduleId)
    }

    /** Unconditionally switch the public state to one module's slice. */
    const switchPublic = (moduleId: string): void => {
      const slice = slices.get(moduleId)
      if (!slice) return
      set({
        moduleId,
        mode: slice.mode,
        run: slice.run,
        steps: slice.steps,
        chapters: slice.chapters,
        index: slice.index,
        speed: slice.speed,
        playing: slice.playing,
        historyLength: slice.historyLength,
      })
    }

    const setSlice = (moduleId: string, patch: Partial<SliceState>): void => {
      const slice = slices.get(moduleId)
      if (!slice) return
      slices.set(moduleId, { ...slice, ...patch })
      syncPublic(moduleId)
    }

    const initStateFor = (moduleId: string, module: VizModule<unknown>): unknown => {
      if (!initStates.has(moduleId)) initStates.set(moduleId, module.engine.init())
      return initStates.get(moduleId)
    }

    /** Advance autoplay by one step (timer callback; re-arms or pauses). */
    const advanceAutoplay = (moduleId: string): void => {
      const slice = slices.get(moduleId)
      if (!slice || !slice.playing) return
      const engine = engines.get(moduleId)
      if (slice.index >= slice.steps.length - 1) {
        setSlice(moduleId, { playing: false })
        engine?.stop()
        return
      }
      const next = slice.index + 1
      setSlice(moduleId, { index: next })
      const fresh = slices.get(moduleId)
      if (!fresh) return
      const step = fresh.steps[next]
      if (isKeyKind(step.kind)) {
        engine?.stop()
        setSlice(moduleId, { playing: false })
      } else {
        engineFor(moduleId).enter(step, fresh.speed)
      }
    }

    const engineFor = (moduleId: string): AutoplayEngine => {
      let engine = engines.get(moduleId)
      if (!engine) {
        engine = new AutoplayEngine(() => advanceAutoplay(moduleId))
        engines.set(moduleId, engine)
      }
      return engine
    }

    const startRun = (moduleId: string, mode: Mode, run: RunDescriptor): void => {
      const previous = get().moduleId
      if (previous && previous !== moduleId) {
        // Park the outgoing module: stop its autoplay, keep its sandbox history.
        engines.get(previous)?.cancel()
        const prevSlice = slices.get(previous)
        if (prevSlice && prevSlice.playing) slices.set(previous, { ...prevSlice, playing: false })
      }
      engines.get(moduleId)?.cancel()

      const slice = ensureSlice(moduleId)
      slices.set(moduleId, {
        ...slice,
        mode,
        run,
        steps: [],
        chapters: [],
        index: -1,
        playing: false,
      })
      switchPublic(moduleId)
      if (!run) return

      void (async () => {
        let module: VizModule<unknown>
        try {
          module = await resolveModule(moduleId)
        } catch {
          return // unknown module: the empty view already shown stays
        }
        const base = slices.get(moduleId)
        if (!base) return

        if (mode === 'guided' && 'scenarioId' in run) {
          const scenario = module.scenarios.find((candidate) => candidate.id === run.scenarioId)
          if (!scenario) return // unknown scenario: keep the empty view
          let prev: unknown =
            scenario.seedState !== undefined ? scenario.seedState : module.engine.init()
          const steps: Step<unknown>[] = []
          for (const op of scenario.ops) {
            const result = module.engine.run(op.opId, op.input, prev)
            if (result.error) break // module-authored inputs should not error
            steps.push(...result.steps)
            prev = result.result
          }
          slices.set(moduleId, {
            ...base,
            run,
            steps,
            chapters: deriveChapters(steps),
            index: steps.length > 0 ? 0 : -1,
            playing: false,
          })
        } else if (mode === 'sandbox' && 'opId' in run) {
          const prevState =
            base.sandboxState !== undefined ? base.sandboxState : initStateFor(moduleId, module)
          const result = module.engine.run(run.opId, run.input, prevState)
          if (result.error) return // invalid input: commits nothing, keeps the empty view
          const history = [...base.history, { run, steps: result.steps, result: result.result }]
          slices.set(moduleId, {
            ...base,
            run,
            steps: result.steps,
            chapters: deriveChapters(result.steps),
            index: result.steps.length > 0 ? result.steps.length - 1 : -1,
            playing: false,
            sandboxState: result.result,
            history,
            historyLength: history.length,
          })
        }
        syncPublic(moduleId)
      })()
    }

    const activeSlice = (): SliceState | null => {
      const moduleId = get().moduleId
      return moduleId ? (slices.get(moduleId) ?? null) : null
    }

    const play = (): void => {
      const moduleId = get().moduleId
      if (!moduleId) return
      const slice = slices.get(moduleId)
      if (!slice || slice.steps.length === 0) return
      if (slice.index >= slice.steps.length - 1) return
      setSlice(moduleId, { playing: true })
      engineFor(moduleId).resume(slice.steps[slice.index], slice.speed)
    }

    const pause = (): void => {
      const moduleId = get().moduleId
      if (!moduleId) return
      setSlice(moduleId, { playing: false })
      engines.get(moduleId)?.stop()
    }

    const stepForward = (): void => {
      const slice = activeSlice()
      if (!slice || slice.steps.length === 0) return
      pause()
      const next = Math.min(slice.index + 1, slice.steps.length - 1)
      if (next !== slice.index) setSlice(get().moduleId as string, { index: next })
    }

    const stepBack = (): void => {
      const slice = activeSlice()
      if (!slice || slice.steps.length === 0) return
      pause()
      const next = Math.max(slice.index - 1, 0)
      if (next !== slice.index) setSlice(get().moduleId as string, { index: next })
    }

    const scrubTo = (index: number): void => {
      const slice = activeSlice()
      if (!slice || slice.steps.length === 0) return
      pause()
      const clamped = Math.max(0, Math.min(Math.round(index), slice.steps.length - 1))
      if (clamped !== slice.index) setSlice(get().moduleId as string, { index: clamped })
    }

    const setSpeed = (speed: number): void => {
      const moduleId = get().moduleId
      if (!moduleId) return
      const slice = slices.get(moduleId)
      if (!slice) return
      const clamped = clampSpeed(speed)
      setSlice(moduleId, { speed: clamped })
      if (slice.playing && slice.index >= 0 && slice.index < slice.steps.length) {
        engineFor(moduleId).resume(slice.steps[slice.index], clamped)
      }
    }

    const fastForwardChapter = (): void => {
      const slice = activeSlice()
      if (!slice || slice.steps.length === 0) return
      const next = slice.chapters.find((chapter) => chapter.start > slice.index)
      const target = next ? next.start : slice.steps.length - 1
      if (target === slice.index) return
      const moduleId = get().moduleId as string
      setSlice(moduleId, { index: target })
      if (!slice.playing) return
      const fresh = slices.get(moduleId)
      if (!fresh) return
      if (target >= fresh.steps.length - 1 || isKeyKind(fresh.steps[target].kind)) {
        engines.get(moduleId)?.stop()
        setSlice(moduleId, { playing: false })
      } else {
        engineFor(moduleId).enter(fresh.steps[target], fresh.speed)
      }
    }

    const undo = (): void => {
      const moduleId = get().moduleId
      if (!moduleId) return
      const slice = slices.get(moduleId)
      if (!slice || slice.mode !== 'sandbox' || slice.history.length === 0) return
      engines.get(moduleId)?.cancel()
      void (async () => {
        let module: VizModule<unknown> | undefined
        try {
          module = await resolveModule(moduleId)
        } catch {
          return
        }
        const current = slices.get(moduleId)
        if (!current || current.mode !== 'sandbox' || current.history.length === 0) return
        const history = current.history.slice(0, -1)
        const last = history.at(-1)
        const sandboxState = last ? last.result : initStateFor(moduleId, module)
        slices.set(moduleId, {
          ...current,
          run: last ? last.run : null,
          steps: last ? last.steps : [],
          chapters: last ? deriveChapters(last.steps) : [],
          index: last && last.steps.length > 0 ? last.steps.length - 1 : -1,
          playing: false,
          sandboxState,
          history,
          historyLength: history.length,
        })
        syncPublic(moduleId)
      })()
    }

    const reset = (): void => {
      const moduleId = get().moduleId
      if (!moduleId) return
      engines.get(moduleId)?.cancel()
      const slice = slices.get(moduleId)
      if (!slice) return
      slices.set(moduleId, {
        ...slice,
        run: null,
        steps: [],
        chapters: [],
        index: -1,
        playing: false,
        historyLength: 0,
        sandboxState: undefined,
        history: [],
      })
      syncPublic(moduleId)
    }

    const onAnimationComplete = (): void => {
      const moduleId = get().moduleId
      if (!moduleId) return
      const slice = slices.get(moduleId)
      if (!slice || slice.steps.length === 0 || slice.index < 0) return
      engines.get(moduleId)?.complete(slice.steps[slice.index], slice.speed)
    }

    return {
      moduleId: null,
      mode: 'guided',
      run: null,
      steps: [],
      chapters: [],
      index: -1,
      speed: 1,
      playing: false,
      historyLength: 0,
      actions: {
        startRun,
        play,
        pause,
        stepForward,
        stepBack,
        scrubTo,
        setSpeed,
        fastForwardChapter,
        undo,
        reset,
        onAnimationComplete,
      },
    }
  })
}

/** The app-wide player store, backed by real module discovery. */
export const usePlayerStore = createPlayerStore()
