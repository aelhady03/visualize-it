// ViewerPage — the '/modules/:id/view' route: the lab itself (PLAN.md §4).
//
// Layout: OperationBar on top; the instrument (DiagramPane with
// StepperControls bolted underneath) in the center; the run log
// (NarrationPanel) on the right. Below 1280px the run log stacks under the
// instrument.
//
// Keyboard shortcuts (PLAN.md §3.3): ←/→ step, Space play/pause, Home/End to
// the first/last step. Ignored while typing in form fields.

import { Suspense, useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePlayerStore } from '@core/player/store'
import { DiagramPane, NarrationPanel, OperationBar, StepperControls } from '@shell/index'
import { ErrorBoundary } from './ErrorBoundary'
import { ModuleNotFound } from './ModuleNotFound'
import { useModule } from './useModule'

function useKeyboardShortcuts() {
  const { steps, playing, actions } = usePlayerStore()
  const playingRef = useRef(playing)
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      if (typing) return

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault()
          actions.stepForward()
          break
        case 'ArrowLeft':
          event.preventDefault()
          actions.stepBack()
          break
        case ' ':
          event.preventDefault()
          if (steps.length > 0) {
            if (playingRef.current) actions.pause()
            else actions.play()
          }
          break
        case 'Home':
          event.preventDefault()
          actions.scrubTo(0)
          break
        case 'End':
          event.preventDefault()
          actions.scrubTo(Math.max(0, steps.length - 1))
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [steps.length, actions])
}

function ViewerInner({ id }: { id: string }) {
  const module = useModule(id)
  useKeyboardShortcuts()

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-[1.5625rem] font-[720] leading-tight tracking-[-0.015em]">
          {module.meta.title}
        </h1>
        <Link
          to={`/modules/${module.meta.id}`}
          className="text-[0.875rem] text-pen underline decoration-pen/40 underline-offset-[3px] hover:decoration-pen"
        >
          Read the primer
        </Link>
      </header>

      <OperationBar
        moduleId={id}
        operations={module.operations}
        settings={module.settings}
        scenarios={module.scenarios}
        inputForm={module.InputForm}
      />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        {/* The instrument: diagram stage with the transport bolted underneath. */}
        <div className="min-w-0 rounded-[12px] bg-well p-2 pb-3 md:p-3">
          <DiagramPane module={module} />
          <StepperControls />
        </div>
        <NarrationPanel intro={module.Intro} />
      </div>
    </div>
  )
}

export function ViewerPage() {
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
        {id ? <ViewerInner key={id} id={id} /> : <ModuleNotFound />}
      </Suspense>
    </ErrorBoundary>
  )
}
