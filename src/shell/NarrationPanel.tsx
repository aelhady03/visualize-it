// NarrationPanel — the run log (PLAN.md §3.3, §4).
//
// Narration reads like a printout of the run: one banded line per step played
// so far, numbered, with its step kind. The current line carries the
// highlighter, and the highlighter slides to whichever line is current, so
// stepping is visible here as well as in the diagram. Chapter boundaries
// (operation starts) print as perforations. Under the current line, the
// optional "why this matters" note is set in the pen voice, and the step's
// metrics follow as a small table with the change since the previous step.
//
// Under every line, a trace names what that step changed (added, found,
// superseded, removed...) by key, so the run can be read like a trace.
// Before the first run, the module's primer (VizModule.Intro) is offered here.
//
// Clicking a past line scrubs back to it. Renders gracefully when there is no
// run yet (empty steps).

import { motion, useReducedMotion } from 'motion/react'
import { Fragment, useEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import { usePlayerStore } from '@core/player/store'
import type { Metrics, Step } from '@core/engine-contract'
import { roleVar } from '@core/theme/tokens'
import { traceStep } from './trace'

function delta(now: Metrics[string], before: Metrics[string] | undefined): string | null {
  if (typeof now !== 'number' || typeof before !== 'number' || now === before) return null
  const d = now - before
  return d > 0 ? `+${d}` : `${d}`
}

/** What this step changed, entity by entity: the trace under each log line. */
function Trace({ step, prev, current }: { step: Step<unknown>; prev?: Step<unknown>; current: boolean }) {
  const { lines } = traceStep(step, prev)
  if (lines.length === 0) return null
  return (
    // Spans, not a list: the trace sits inside the line's <button>.
    <span className={`mt-1 flex flex-col gap-0.5 text-[0.8125rem] ${current ? 'text-ink' : 'text-ink-soft'}`}>
      {lines.map((line) => (
        <span key={line.role} className="flex items-baseline gap-1.5">
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0 self-center">
            <rect x="0.5" y="0.5" width="7" height="7" rx="1.5" fill={roleVar(line.role)} />
          </svg>
          <span className="shrink-0">{line.verb}</span>
          <span className="voice-printed min-w-0 break-words">{line.names.join(', ')}</span>
        </span>
      ))}
    </span>
  )
}

export interface NarrationPanelProps {
  /** The module's primer (VizModule.Intro), offered before the first run. */
  intro?: ComponentType
}

export function NarrationPanel({ intro: Intro }: NarrationPanelProps = {}) {
  const { steps, chapters, index, actions } = usePlayerStore()
  const reduced = useReducedMotion() ?? false
  const currentRef = useRef<HTMLLIElement>(null)

  // The store uses index -1 when there is no timeline to show.
  const hasStep = steps.length > 0 && index >= 0
  const current = hasStep ? Math.min(index, steps.length - 1) : -1
  const step = hasStep ? steps[current] : undefined
  const prev = current > 0 ? steps[current - 1] : undefined
  // Perforate only at chapters that span several steps: a one-step chapter is
  // already labelled by its own step kind, and a tear line per step is noise.
  const chapterStarts = new Map(chapters.filter((c) => c.end > c.start).map((c) => [c.start, c.label]))

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [current, reduced])

  return (
    <aside
      aria-label="Narration"
      className="flex min-h-0 flex-col rounded-[10px] border border-rule bg-paper xl:max-h-[calc(100vh-11rem)]"
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-rule px-4 py-3">
        <h2 className="text-[1rem] font-[650]">Run log</h2>
        {step && (
          <span className="voice-printed text-[0.8125rem] text-ink-soft tabular-nums">
            {current + 1} of {steps.length}
          </span>
        )}
      </header>

      {!step ? (
        <div className="px-4 py-6">
          <p className="max-w-[40ch] text-[1rem] leading-[1.6]">
            Run an operation from the bar above. Each step prints here as it plays: what changed,
            and why.
          </p>
          <p className="mt-3 text-[0.875rem] text-ink-soft">
            Use <kbd className="voice-printed">←</kbd> and <kbd className="voice-printed">→</kbd> to
            step, <kbd className="voice-printed">Space</kbd> to play or pause.
          </p>
          {Intro && (
            <details className="mt-5 border-t border-rule pt-4" open>
              <summary className="cursor-pointer select-none text-[0.9375rem] font-[650]">
                Primer: read this first
              </summary>
              <div className="mt-2 max-h-[50vh] overflow-y-auto pr-1 text-[0.9375rem] leading-[1.6] [&_p]:text-[0.9375rem] [&_p]:leading-[1.6]">
                <Intro />
              </div>
            </details>
          )}
        </div>
      ) : (
        <>
          <ol className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Steps so far">
            {steps.slice(0, current + 1).map((s, i) => {
              const isCurrent = i === current
              const chapterLabel = i > 0 ? chapterStarts.get(i) : undefined
              return (
                <Fragment key={i}>
                  {chapterLabel !== undefined && (
                    <li aria-hidden="true" className="flex items-center gap-2 px-4 py-1.5 text-ink-soft">
                      <span className="h-0 flex-1 border-t border-dashed border-rule" />
                      <span className="voice-printed text-[0.75rem]">{chapterLabel}</span>
                      <span className="h-0 flex-1 border-t border-dashed border-rule" />
                    </li>
                  )}
                  <li
                    ref={isCurrent ? currentRef : undefined}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={i % 2 === 1 ? 'bg-band/70' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => actions.scrubTo(i)}
                      disabled={isCurrent}
                      className="relative grid w-full grid-cols-[2rem_minmax(0,1fr)] gap-x-2 px-4 py-2.5 text-left enabled:cursor-pointer enabled:hover:bg-band"
                      aria-label={isCurrent ? undefined : `Go back to step ${i + 1}: ${s.kind}`}
                    >
                      {isCurrent &&
                        (reduced ? (
                          <span aria-hidden="true" className="absolute inset-x-2 inset-y-1 rounded-[3px] bg-hilite/80" />
                        ) : (
                          <motion.span
                            layoutId="run-log-highlighter"
                            aria-hidden="true"
                            className="absolute inset-x-2 inset-y-1 rounded-[3px] bg-hilite/80"
                            transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                          />
                        ))}
                      <span className="voice-printed relative pt-[0.2rem] text-[0.8125rem] text-ink-soft tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="relative flex flex-col gap-0.5">
                        <span className="voice-printed text-[0.75rem] text-ink-soft">{s.kind}</span>
                        <span
                          className={
                            isCurrent
                              ? 'text-[1rem] leading-[1.55] text-ink'
                              : 'text-[0.875rem] leading-[1.5] text-ink-soft'
                          }
                        >
                          {s.narration}
                        </span>
                        <Trace step={s} prev={i > 0 ? steps[i - 1] : undefined} current={isCurrent} />
                      </span>
                    </button>
                  </li>
                </Fragment>
              )
            })}
          </ol>

          {(step.why || (step.metrics && Object.keys(step.metrics).length > 0)) && (
            <div className="flex flex-col gap-4 border-t border-rule px-4 py-4">
              {step.why && (
                <details className="group" open>
                  <summary className="voice-pen flex cursor-pointer select-none items-center gap-2 text-[0.9375rem] font-[600] text-pen">
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
                      <path
                        d="M11.2 1.8l3 3-8.6 8.6-3.7.7.7-3.7z M9.8 3.2l3 3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Why this matters
                  </summary>
                  <p className="voice-pen mt-2 border-l-2 border-pen/60 pl-3 text-[0.9375rem] leading-[1.6] text-ink">
                    {step.why}
                  </p>
                </details>
              )}

              {step.metrics && Object.keys(step.metrics).length > 0 && (
                <section aria-label="Metrics">
                  <h3 className="mb-1.5 text-[0.875rem] font-[600] text-ink-soft">Counters</h3>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto_3rem] gap-x-3 gap-y-1 text-[0.875rem]">
                    {Object.entries(step.metrics).map(([name, value]) => {
                      const change = delta(value, prev?.metrics?.[name])
                      return (
                        <div key={name} className="contents">
                          <dt className="truncate text-ink-soft">{name}</dt>
                          <dd className="voice-printed text-right tabular-nums">{value}</dd>
                          <dd className="voice-printed text-right text-[0.8125rem] text-pen tabular-nums">
                            {change ?? ''}
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}
