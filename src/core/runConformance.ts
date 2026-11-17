/**
 * Conformance suite (PLAN.md §3.5) — the acceptance bar every module's test
 * file calls. Seven checks:
 *
 * 1. determinism     — the same input twice gives deep-equal steps;
 * 2. json-roundtrip  — every step state survives JSON.stringify/parse
 *                      (explicit `undefined` is normalized away before
 *                      comparing — modules must not rely on it surviving);
 * 3. narration+kind  — every step has a non-empty `narration` and `kind`;
 * 4. result-invariant — `result` deep-equals `steps.at(-1).state` when steps exist;
 * 5. scenario-run    — every scenario runs without error from `init()` (or its seed state);
 * 6. sandbox-inputSchema — every sandbox-mode operation declares an `inputSchema`;
 *                      an empty or ABSENT schema is allowed when the operation
 *                      needs no input (the shell renders a bare run button);
 * 7. render-mount    — `Render` mounts for every step of every scenario
 *                      (jsdom + @testing-library/react): once with
 *                      `reducedMotion: true`, where `onAnimationComplete` must
 *                      fire (the contract requires it, even when nothing
 *                      animates), and once with `reducedMotion: false`, a
 *                      smoke test of the animating path that tolerates a
 *                      slow or jsdom-stalled animation.
 *
 * Failures are collected (one check may report several), and every message
 * names the check and the module. Async-safe: `Render` may use effects, so
 * each mount is awaited.
 */

import { createElement, type ComponentType } from 'react'
import { render, waitFor } from '@testing-library/react'
import type { OpInput, Operation, RunResult, Step } from './engine-contract'
import type { RenderProps, VizModule } from './view-contract'

export interface ConformanceReport {
  moduleId: string
  passed: boolean
  failures: string[]
}

const CHECK_DETERMINISM = 'determinism'
const CHECK_JSON = 'json-roundtrip'
const CHECK_STEP_TEXT = 'narration+kind'
const CHECK_RESULT = 'result-invariant'
const CHECK_SCENARIO = 'scenario-run'
const CHECK_SCHEMA = 'sandbox-inputSchema'
const CHECK_RENDER = 'render-mount'
const CHECK_COMPLETE = 'render.onAnimationComplete'

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// --- deep equality that survives JSON round-trips ----------------------------

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

/** Drop `undefined` the way JSON does, so comparisons ignore reliance on it. */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined).map(stripUndefined)
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) out[key] = stripUndefined(entry)
    }
    return out
  }
  return value
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return stableStringify(stripUndefined(a)) === stableStringify(stripUndefined(b))
}

/** Check 2 for one state: returns null when it survives a JSON round-trip. */
function roundTripFailure(state: unknown): string | null {
  let json: string | undefined
  try {
    json = JSON.stringify(state)
  } catch (err) {
    return `state is not JSON-serializable (${message(err)})`
  }
  if (json === undefined) {
    return 'state is not a JSON value (undefined or a function)'
  }
  let roundTripped: unknown
  try {
    roundTripped = JSON.parse(json)
  } catch (err) {
    return `state failed to parse back from JSON (${message(err)})`
  }
  if (!deepEqualJson(state, roundTripped)) {
    return 'state changes when round-tripped through JSON (it relies on undefined surviving, or on non-JSON values)'
  }
  return null
}

// --- scenario runner ----------------------------------------------------------

type ScenarioSpec = VizModule<unknown>['scenarios'][number]

interface ScenarioCapture {
  scenario: ScenarioSpec
  steps: Step<unknown>[]
  results: RunResult<unknown>[]
}

/** Run one scenario's chained ops from `init()` (or its seed state). */
function runScenario(module: VizModule<unknown>, scenario: ScenarioSpec): ScenarioCapture {
  // Clone the seed state so a mutating engine cannot poison the second run.
  const seed = scenario.seedState !== undefined ? JSON.parse(JSON.stringify(scenario.seedState)) : undefined
  let prev: unknown = seed !== undefined ? seed : module.engine.init()
  const steps: Step<unknown>[] = []
  const results: RunResult<unknown>[] = []
  for (const op of scenario.ops) {
    const result = module.engine.run(op.opId, op.input, prev)
    if (result.error) {
      throw new Error(`op "${op.opId}" returned error "${result.error}"`)
    }
    results.push(result)
    steps.push(...result.steps)
    prev = result.result
  }
  return { scenario, steps, results }
}

/** A reasonable sandbox input built from an op's inputSchema defaults. */
function defaultInput(op: Operation): OpInput {
  const input: OpInput = {}
  for (const field of op.inputSchema ?? []) {
    if (field.default !== undefined) input[field.id] = field.default
    else if (field.type === 'number') input[field.id] = 1
    else if (field.type === 'boolean') input[field.id] = true
    else if (field.type === 'select') input[field.id] = field.options?.[0] ?? ''
    else input[field.id] = 'sample'
  }
  return input
}

// --- the suite -----------------------------------------------------------------

/**
 * Run all seven checks. Generic over the module's state type (`VizModule<S>`
 * is invariant in `S` through `Render`, so accepting `VizModule<unknown>` only
 * would reject every concrete module); internally the state is opaque.
 */
export async function runConformance<S>(module: VizModule<S>): Promise<ConformanceReport> {
  const mod = module as unknown as VizModule<unknown>
  const failures: string[] = []
  const fail = (check: string, detail: string): void => {
    failures.push(`${mod.meta.id}: [${check}] ${detail}`)
  }

  // Check 5: every scenario runs without error from init() / its seed state.
  const captures: ScenarioCapture[] = []
  for (const scenario of mod.scenarios) {
    try {
      captures.push(runScenario(mod, scenario))
    } catch (err) {
      fail(CHECK_SCENARIO, `scenario "${scenario.id}" did not run without error: ${message(err)}`)
    }
  }

  // Sandbox ops (checked for determinism, round-trips and the result invariant).
  const sandboxOps = mod.operations.filter((op) => op.mode === 'sandbox' || op.mode === 'both')
  const sandboxRuns: Array<{ op: Operation; run: RunResult<unknown> }> = []
  for (const op of sandboxOps) {
    try {
      sandboxRuns.push({ op, run: mod.engine.run(op.id, defaultInput(op), mod.engine.init()) })
    } catch (err) {
      fail(CHECK_DETERMINISM, `sandbox op "${op.id}" threw: ${message(err)}`)
    }
  }

  // Check 6: every sandbox-mode operation declares an inputSchema. An empty
  // or absent schema is ALLOWED when the operation needs no input (the shell
  // renders a bare run button) — PLAN.md §3.5. A present-but-malformed schema
  // (not an array) is still an error.
  for (const op of sandboxOps) {
    if (op.inputSchema !== undefined && op.inputSchema !== null && !Array.isArray(op.inputSchema)) {
      fail(CHECK_SCHEMA, `sandbox operation "${op.id}" declares a malformed inputSchema`)
    }
  }

  // Check 1: determinism — the same input twice gives deep-equal steps.
  for (const capture of captures) {
    try {
      const again = runScenario(mod, capture.scenario)
      if (!deepEqualJson(capture.steps, again.steps)) {
        fail(
          CHECK_DETERMINISM,
          `scenario "${capture.scenario.id}" produced different steps on a second run`,
        )
      }
    } catch (err) {
      fail(
        CHECK_DETERMINISM,
        `scenario "${capture.scenario.id}" threw on the determinism re-run: ${message(err)}`,
      )
    }
  }
  for (const { op } of sandboxRuns) {
    try {
      const a = mod.engine.run(op.id, defaultInput(op), mod.engine.init())
      const b = mod.engine.run(op.id, defaultInput(op), mod.engine.init())
      if (!deepEqualJson(a.steps, b.steps)) {
        fail(CHECK_DETERMINISM, `sandbox op "${op.id}" produced different steps on a second run`)
      }
    } catch (err) {
      fail(CHECK_DETERMINISM, `sandbox op "${op.id}" threw on the determinism re-run: ${message(err)}`)
    }
  }

  // Checks 2 + 3: every step state round-trips; every step has kind + narration.
  const allSteps: Step<unknown>[] = [
    ...captures.flatMap((capture) => capture.steps),
    ...sandboxRuns.flatMap(({ run }) => run.steps),
  ]
  allSteps.forEach((step, index) => {
    const failure = roundTripFailure(step.state)
    if (failure) fail(CHECK_JSON, `step ${index} ${failure}`)
    if (typeof step.kind !== 'string' || step.kind.trim().length === 0) {
      fail(CHECK_STEP_TEXT, `step ${index} has an empty kind`)
    }
    if (typeof step.narration !== 'string' || step.narration.trim().length === 0) {
      fail(CHECK_STEP_TEXT, `step ${index} has an empty narration`)
    }
  })

  // Check 4: result deep-equals steps.at(-1).state whenever steps exist.
  const allRuns: RunResult<unknown>[] = [
    ...captures.flatMap((capture) => capture.results),
    ...sandboxRuns.map(({ run }) => run),
  ]
  allRuns.forEach((run, index) => {
    if (run.steps.length === 0) return
    if (!deepEqualJson(run.result, run.steps.at(-1)!.state)) {
      fail(CHECK_RESULT, `run ${index} result does not deep-equal its last step state`)
    }
  })

  // Check 7: Render mounts for every step of every scenario, twice:
  // - pass 1, reducedMotion: true — the Render must mount AND call
  //   `onAnimationComplete` (nothing animates, so the callback is required);
  // - pass 2, reducedMotion: false — smoke test of the animating path: the
  //   Render must mount, but a slow or jsdom-stalled animation is tolerated,
  //   so completion is only waited for a short COMPLETION_TIMEOUT.
  const COMPLETION_TIMEOUT_MS = 50
  for (const capture of captures) {
    for (let i = 0; i < capture.steps.length; i += 1) {
      const step = capture.steps[i]
      const baseProps: Omit<RenderProps<unknown>, 'reducedMotion' | 'onAnimationComplete'> = {
        state: step.state,
        prevState: i > 0 ? capture.steps[i - 1].state : capture.scenario.seedState,
        direction: 1,
        speed: 1,
        highlights: step.highlights ?? [],
      }

      for (const [reducedMotion, requireCompletion, completionTimeout, check] of [
        [true, true, 1000, CHECK_RENDER],
        [false, false, COMPLETION_TIMEOUT_MS, CHECK_RENDER],
      ] as const) {
        let completed = false
        const props: RenderProps<unknown> = {
          ...baseProps,
          reducedMotion,
          onAnimationComplete: () => {
            completed = true
          },
        }
        let unmount: (() => void) | null = null
        try {
          const rendered = render(
            createElement(mod.Render as ComponentType<RenderProps<unknown>>, props),
          )
          unmount = rendered.unmount
          await waitFor(
            () => {
              if (!rendered.container.firstElementChild) throw new Error('rendered nothing')
            },
            { timeout: 1000 },
          )
        } catch (err) {
          fail(
            check,
            `scenario "${capture.scenario.id}" step ${i} (reducedMotion: ${reducedMotion}) did not mount: ${message(err)}`,
          )
        }
        if (unmount) {
          try {
            await waitFor(
              () => {
                if (!completed) throw new Error('not completed yet')
              },
              { timeout: completionTimeout },
            )
          } catch {
            if (requireCompletion) {
              fail(
                CHECK_COMPLETE,
                `scenario "${capture.scenario.id}" step ${i} never called onAnimationComplete`,
              )
            }
          }
          unmount()
        }
      }
    }
  }

  return { moduleId: mod.meta.id, passed: failures.length === 0, failures }
}
