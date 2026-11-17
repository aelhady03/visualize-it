// ModuleHomePage — the '/modules/:id' route: module meta, difficulty, topics
// and the entry point into the viewer. The Intro primer component is not
// implemented yet (PLAN.md §6: Intro.tsx), so a labeled placeholder stands in.

import { Link, useParams } from 'react-router-dom'
import { Suspense } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { ModuleNotFound } from './ModuleNotFound'
import { useModule } from './useModule'

const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: 'text-emerald-600 dark:text-emerald-400',
  intermediate: 'text-amber-600 dark:text-amber-400',
  advanced: 'text-rose-600 dark:text-rose-400',
}

function HomeInner({ id }: { id: string }) {
  const module = useModule(id)

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="mb-1 text-sm text-neutral-500 dark:text-neutral-400">
          <Link to="/" className="hover:underline">
            Modules
          </Link>{' '}
          / {module.meta.category}
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{module.meta.title}</h1>
          <span
            className={`text-sm font-medium capitalize ${DIFFICULTY_LABEL[module.meta.difficulty] ?? ''}`}
          >
            {module.meta.difficulty}
          </span>
        </div>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">{module.meta.description}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {module.meta.topics.map((topic) => (
            <li
              key={topic}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {topic}
            </li>
          ))}
        </ul>
      </header>

      {/* Intro primer placeholder — module-provided Intro components land in a later phase. */}
      <div className="mb-6 rounded-lg border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <p className="font-medium">Introduction coming soon</p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          The module&apos;s Intro primer will explain the engine here.
        </p>
      </div>

      <Link
        to={`/modules/${module.meta.id}/view`}
        className="inline-block rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
      >
        Open the lab →
      </Link>
    </div>
  )
}

export function ModuleHomePage() {
  const { id } = useParams()

  return (
    <ErrorBoundary fallback={<ModuleNotFound />}>
      <Suspense
        fallback={
          <p className="p-6 text-neutral-500 dark:text-neutral-400" role="status">
            Loading module…
          </p>
        }
      >
        {id ? <HomeInner key={id} id={id} /> : <ModuleNotFound />}
      </Suspense>
    </ErrorBoundary>
  )
}
