// Sidebar — module navigation (PLAN.md §4).
//
// Lists every discovered module (getModules()) grouped by meta.category and
// ordered by meta.order, with react-router links to each module's home.
// Renders gracefully when no modules exist.

import { NavLink } from 'react-router-dom'
import { getModules, type ModuleSummary } from '@core/discovery'

const DIFFICULTY_BADGE: Record<string, string> = {
  beginner: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  intermediate: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  advanced: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
}

function groupByCategory(modules: ModuleSummary[]): [string, ModuleSummary[]][] {
  const groups = new Map<string, ModuleSummary[]>()
  for (const m of modules) {
    const list = groups.get(m.meta.category)
    if (list) list.push(m)
    else groups.set(m.meta.category, [m])
  }
  return [...groups.entries()]
}

export function Sidebar() {
  const modules = getModules()
  const groups = groupByCategory(modules)

  return (
    <nav
      aria-label="Modules"
      className="flex w-full shrink-0 flex-col gap-4 overflow-x-auto border-b border-neutral-200 bg-neutral-100 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900 xl:h-screen xl:w-64 xl:overflow-y-auto xl:border-b-0 xl:border-r xl:px-5 xl:py-6"
    >
      <header className="shrink-0">
        <p className="text-lg font-semibold tracking-tight">Visualize It</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Storage engines, step by step
        </p>
      </header>

      {modules.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No modules yet — the first engine is on its way.
        </p>
      ) : (
        groups.map(([category, mods]) => (
          <section key={category} className="shrink-0">
            <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              {category}
            </h2>
            <ul className="flex gap-1 xl:flex-col">
              {mods.map((m) => (
                <li key={m.meta.id} className="shrink-0">
                  <NavLink
                    to={`/modules/${m.meta.id}`}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white'
                          : 'text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60',
                      ].join(' ')
                    }
                  >
                    {m.meta.title}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${DIFFICULTY_BADGE[m.meta.difficulty] ?? 'bg-neutral-200 dark:bg-neutral-800'}`}
                    >
                      {m.meta.difficulty}
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </nav>
  )
}
