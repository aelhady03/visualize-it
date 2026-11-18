// ModuleHomePage — the '/modules/:id' route: what the module covers, its
// primer (VizModule.Intro) in a reading column, the operations it can run,
// and the way into the simulator.

import { Link, useParams } from 'react-router-dom'
import { Suspense } from 'react'
import { Difficulty } from '@shell/Difficulty'
import { ErrorBoundary } from './ErrorBoundary'
import { ModuleNotFound } from './ModuleNotFound'
import { useModule } from './useModule'

function HomeInner({ id }: { id: string }) {
  const module = useModule(id)
  const viewer = `/modules/${module.meta.id}/view`

  return (
    <article className="mx-auto max-w-5xl">
      <Link
        to="/"
        className="text-[0.875rem] text-pen underline decoration-pen/40 underline-offset-[3px] hover:decoration-pen"
      >
        All modules
      </Link>

      <header className="mt-4 border-b border-rule pb-6">
        <h1 className="text-[2.4375rem] font-[760] leading-[1.05] tracking-[-0.025em]">
          {module.meta.title}
        </h1>
        <p className="mt-3 max-w-[60ch] text-[1.125rem] leading-[1.55] text-ink-soft">
          {module.meta.description}
        </p>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3 text-[0.875rem]">
          <div>
            <dt className="text-ink-soft">Level</dt>
            <dd className="mt-0.5">
              <Difficulty level={module.meta.difficulty} showLabel />
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Topics</dt>
            <dd className="mt-0.5">
              <ul className="flex flex-wrap gap-x-1">
                {module.meta.topics.map((topic, i) => (
                  <li key={topic}>
                    {topic}
                    {i < module.meta.topics.length - 1 ? ',' : ''}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Category</dt>
            <dd className="mt-0.5">{module.meta.category}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-10 pt-8 lg:grid-cols-[minmax(0,62ch)_minmax(0,1fr)]">
        {/* Module-provided Intro primer (VizModule.Intro); invitation for modules without one. */}
        {module.Intro ? (
          <section
            aria-label="Introduction"
            className="text-[1.0625rem] leading-[1.65] [&_p]:text-[1.0625rem] [&_p]:leading-[1.65] [&_strong]:font-[650]"
          >
            <module.Intro />
          </section>
        ) : (
          <section aria-label="Introduction" className="rounded-[10px] border border-dashed border-rule p-6">
            <p className="text-[1.0625rem] font-[600]">No primer for this module yet</p>
            <p className="mt-1 text-ink-soft">
              Open the simulator and run a guided example: the run log explains every step as it
              plays.
            </p>
          </section>
        )}

        <aside className="flex flex-col gap-5 self-start lg:sticky lg:top-8">
          <div className="flex flex-col items-start gap-2">
            <Link
              to={viewer}
              className="inline-flex h-11 items-center rounded-md bg-pen px-5 text-[1rem] font-[620] text-pen-ink transition-[filter] hover:brightness-110"
            >
              Open the simulator
            </Link>
            <p className="text-[0.875rem] text-ink-soft">
              Starts on a guided example. Switch to Sandbox to use your own keys.
            </p>
          </div>

          {module.operations.length > 0 && (
            <section aria-labelledby="ops-heading">
              <h2 id="ops-heading" className="mb-2 text-[1rem] font-[650]">
                What you can run
              </h2>
              <dl className="overflow-hidden rounded-[10px] border border-rule">
                {module.operations.map((op, i) => (
                  <div key={op.id} className={`px-4 py-2.5 ${i % 2 === 1 ? 'bg-band/70' : ''}`}>
                    <dt className="font-[620]">{op.label}</dt>
                    <dd className="text-[0.9375rem] leading-[1.5] text-ink-soft">{op.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </aside>
      </div>
    </article>
  )
}

export function ModuleHomePage() {
  const { id } = useParams()

  return (
    <ErrorBoundary fallback={<ModuleNotFound id={id} />}>
      <Suspense
        fallback={
          <p className="p-6 text-ink-soft" role="status">
            Loading the module…
          </p>
        }
      >
        {id ? <HomeInner key={id} id={id} /> : <ModuleNotFound />}
      </Suspense>
    </ErrorBoundary>
  )
}
