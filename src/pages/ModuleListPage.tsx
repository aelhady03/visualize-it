// ModuleListPage — the '/' route: every discovered module (PLAN.md §4).
//
// Opens with the app's one orchestrated moment (LogThenSort), then lists the
// modules as a sorted table: one banded row per module, grouped by category,
// keyed by module id. Modules come from getModules(), already sorted by
// category + order. Renders gracefully when zero modules are discovered.

import { Link } from 'react-router-dom'
import { getModules, type ModuleSummary } from '@core/discovery'
import { Difficulty } from '@shell/Difficulty'
import { LogThenSort } from './LogThenSort'

function groupByCategory(modules: ModuleSummary[]): [string, ModuleSummary[]][] {
  const groups = new Map<string, ModuleSummary[]>()
  for (const m of modules) {
    const list = groups.get(m.meta.category)
    if (list) list.push(m)
    else groups.set(m.meta.category, [m])
  }
  return [...groups.entries()]
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function ModuleListPage() {
  const modules = getModules()
  const groups = groupByCategory(modules)
  // Bands alternate across the whole table, not per group, like printout rows.
  const rowIndex = new Map(modules.map((m, i) => [m.meta.id, i]))

  return (
    <div className="mx-auto max-w-5xl">
      <header className="grid items-end gap-8 pb-10 pt-2 md:pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <div>
          <h1 className="text-[2.5rem] font-[780] leading-[1.02] tracking-[-0.03em] md:text-[3.25rem]">
            See how a database stores your data.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[1.0625rem] leading-[1.6] text-ink-soft">
            Each module is a working model of one storage engine. Run a write, a read or a
            compaction and watch it happen one step at a time, with a note on why each step exists.
          </p>
        </div>
        <figure className="flex flex-col gap-2">
          <LogThenSort />
          <figcaption className="voice-pen text-[0.9375rem] leading-[1.5] text-pen">
            Writes land in arrival order. Sorting them by key is the first step toward an SSTable.
          </figcaption>
        </figure>
      </header>

      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="mb-3 text-[1.25rem] font-[680] tracking-[-0.01em]">
          Pick a module
        </h2>

        {modules.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-rule px-6 py-10">
            <p className="text-[1.0625rem] font-[600]">No modules yet</p>
            <p className="mt-1 max-w-[56ch] text-ink-soft">
              Add a folder under <span className="voice-printed">src/modules/</span> with a{' '}
              <span className="voice-printed">meta.ts</span> and an{' '}
              <span className="voice-printed">index.ts</span>, and it appears here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[10px] border border-rule">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[11rem_minmax(0,1fr)_8rem] gap-6 border-b border-rule px-5 py-2 text-[0.8125rem] text-ink-soft md:grid"
            >
              <span>Key</span>
              <span>Module</span>
              <span>Level</span>
            </div>
            {groups.map(([category, mods]) => (
              <div key={category}>
                <h3 className="border-b border-rule bg-paper px-5 py-2 text-[0.875rem] font-[650] text-ink-soft">
                  {category}
                </h3>
                <ul>
                  {mods.map((m) => (
                    <li key={m.meta.id} className={rowIndex.get(m.meta.id)! % 2 === 1 ? 'bg-band/70' : undefined}>
                      <Link
                        to={`/modules/${m.meta.id}`}
                        className="group grid gap-x-6 gap-y-1.5 px-5 py-4 transition-colors hover:bg-band md:grid-cols-[11rem_minmax(0,1fr)_8rem]"
                      >
                        <span className="voice-printed pt-1 text-[0.875rem] text-ink-soft">{m.meta.id}</span>
                        <span className="flex flex-col gap-1">
                          <span className="text-[1.1875rem] font-[650] text-pen underline decoration-transparent underline-offset-[4px] transition-colors group-hover:decoration-pen/50">
                            {m.meta.title}
                          </span>
                          <span className="max-w-[64ch] leading-[1.55] text-ink">{m.meta.description}</span>
                          <span className="text-[0.875rem] text-ink-soft">
                            Covers {m.meta.topics.join(', ')}. {plural(m.operations.length, 'operation')} to run.
                          </span>
                        </span>
                        <span className="pt-1">
                          <Difficulty level={m.meta.difficulty} showLabel />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
