// Sidebar — module navigation (PLAN.md §4).
//
// Lists every discovered module (getModules()) grouped by meta.category and
// ordered by meta.order, with react-router links to each module's home.
// Renders gracefully when no modules exist. Below 1280px it becomes a
// horizontal strip above the page.

import { Link, NavLink } from 'react-router-dom'
import { getModules, type ModuleSummary } from '@core/discovery'
import { Difficulty } from './Difficulty'

function groupByCategory(modules: ModuleSummary[]): [string, ModuleSummary[]][] {
  const groups = new Map<string, ModuleSummary[]>()
  for (const m of modules) {
    const list = groups.get(m.meta.category)
    if (list) list.push(m)
    else groups.set(m.meta.category, [m])
  }
  return [...groups.entries()]
}

/** The wordmark glyph: three printout rows, the middle one highlighted. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect x="3" y="5" width="26" height="5" rx="1.2" fill="var(--band)" />
      <rect x="3" y="13.5" width="26" height="5" rx="1.2" fill="var(--hilite)" />
      <rect x="3" y="22" width="26" height="5" rx="1.2" fill="var(--band)" />
      <rect x="3" y="5" width="8" height="5" rx="1.2" fill="var(--viz-file)" />
      <rect x="3" y="13.5" width="14" height="5" rx="1.2" fill="var(--ink)" />
      <rect x="3" y="22" width="20" height="5" rx="1.2" fill="var(--pen)" />
    </svg>
  )
}

export function Sidebar() {
  const modules = getModules()
  const groups = groupByCategory(modules)

  return (
    <nav
      aria-label="Modules"
      className="flex w-full shrink-0 items-start gap-6 overflow-x-auto border-b border-rule px-4 py-3 md:px-8 xl:sticky xl:top-0 xl:h-screen xl:w-60 xl:flex-col xl:gap-7 xl:overflow-y-auto xl:border-b-0 xl:border-r xl:px-5 xl:py-7"
    >
      <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-md">
        <Mark />
        <span className="flex flex-col leading-tight">
          <span className="text-[1.0625rem] font-[720] tracking-[-0.01em]">Visualize It</span>
          <span className="hidden text-[0.8125rem] text-ink-soft xl:block">
            Storage engines, step by step
          </span>
        </span>
      </Link>

      {modules.length === 0 ? (
        <p className="max-w-56 text-[0.8125rem] text-ink-soft">
          Add a module folder under src/modules and it shows up here.
        </p>
      ) : (
        groups.map(([category, mods]) => (
          <section key={category} className="flex shrink-0 items-center gap-2 xl:block xl:w-full">
            <h2 className="shrink-0 px-2 text-[0.8125rem] font-[600] text-ink-soft xl:mb-1.5">
              {category}
            </h2>
            <ul className="flex gap-1 xl:flex-col">
              {mods.map((m) => (
                <li key={m.meta.id} className="shrink-0">
                  <NavLink
                    to={`/modules/${m.meta.id}`}
                    className={({ isActive }) =>
                      [
                        'relative flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[0.9375rem] transition-colors',
                        isActive
                          ? 'bg-band font-[600] text-ink before:absolute before:inset-y-1.5 before:-left-0.5 before:w-[3px] before:rounded-full before:bg-pen'
                          : 'text-ink hover:bg-band/60',
                      ].join(' ')
                    }
                  >
                    {m.meta.title}
                    <Difficulty level={m.meta.difficulty} />
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Link
        to="/primitives"
        className="hidden shrink-0 px-2 text-[0.8125rem] text-ink-soft underline decoration-rule underline-offset-[3px] hover:text-pen xl:mt-auto xl:block"
      >
        Diagram parts for module authors
      </Link>
    </nav>
  )
}
