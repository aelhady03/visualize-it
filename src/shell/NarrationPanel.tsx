// NarrationPanel — narration, expandable "why this matters" and live metrics
// for the current step (PLAN.md §3.3, §4).
//
// Reads the current step from the player store and renders gracefully when
// there is no run yet (empty steps).

import { usePlayerStore } from '@core/player/store'

export function NarrationPanel() {
  const { steps, index } = usePlayerStore()
  const step = steps.length > 0 ? steps[Math.min(index, steps.length - 1)] : undefined
  const stepNumber = steps.length > 0 ? Math.min(index, steps.length - 1) + 1 : 0

  return (
    <aside
      aria-label="Narration"
      className="flex h-full flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Narration
        </h2>
        {step && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {stepNumber}/{steps.length}
          </span>
        )}
      </header>

      {!step ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Run an operation to see the step-by-step story — each step explains what happened and
          why.
        </p>
      ) : (
        <>
          <span className="w-fit rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {step.kind}
          </span>
          <p className="text-sm leading-relaxed">{step.narration}</p>

          {step.why && (
            <details className="group rounded-md border border-neutral-200 dark:border-neutral-800">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-sky-700 dark:text-sky-400">
                Why this matters
              </summary>
              <p className="border-t border-neutral-200 px-3 py-2 text-sm leading-relaxed dark:border-neutral-800">
                {step.why}
              </p>
            </details>
          )}

          {step.metrics && Object.keys(step.metrics).length > 0 && (
            <section aria-label="Metrics">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Metrics
              </h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                {Object.entries(step.metrics).map(([name, value]) => (
                  <div key={name} className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-neutral-500 dark:text-neutral-400">{name}</dt>
                    <dd className="font-mono text-sm">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </>
      )}
    </aside>
  )
}
