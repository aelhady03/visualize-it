// ModuleListPage — the '/' route: every discovered module (PLAN.md §4).
//
// Modules come from getModules(), already sorted by category + order.
// Renders gracefully when zero modules are discovered.

import { Link } from 'react-router-dom'
import { getModules } from '@core/discovery'

const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: 'text-emerald-600 dark:text-emerald-400',
  intermediate: 'text-amber-600 dark:text-amber-400',
  advanced: 'text-rose-600 dark:text-rose-400',
}

export function ModuleListPage() {
  const modules = getModules()

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Visualize It</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Interactive, step-by-step visualizations of storage engines and their internals. Pick a
          module to open the lab.
        </p>
      </header>

      {modules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <p className="font-medium">No modules installed yet</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Modules are discovered automatically — the first engine will show up here as soon as
            it&apos;s added.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4">
          {modules.map((m) => (
            <li key={m.meta.id}>
              <Link
                to={`/modules/${m.meta.id}`}
                className="block rounded-lg border border-neutral-200 bg-white p-5 transition-colors hover:border-sky-400 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-semibold">{m.meta.title}</h2>
                  <span
                    className={`text-xs font-medium capitalize ${DIFFICULTY_LABEL[m.meta.difficulty] ?? ''}`}
                  >
                    {m.meta.difficulty}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                  {m.meta.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.meta.topics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      {topic}
                    </span>
                  ))}
                  <span className="ml-auto self-center text-xs text-neutral-500 dark:text-neutral-500">
                    {m.operations.length} operation{m.operations.length === 1 ? '' : 's'} ·{' '}
                    {m.settings.length} setting{m.settings.length === 1 ? '' : 's'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
