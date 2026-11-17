// ViewerPage — the '/modules/:id/view' route: the lab itself (PLAN.md §4).
//
// Layout: OperationBar on top, the module's Render (DiagramPane) in the
// center, NarrationPanel on the right, StepperControls at the bottom.
// Below ~1280px the grid collapses to a single column.
//
// Keyboard shortcuts (PLAN.md §3.3): ←/→ step, Space play/pause, Home/End to
// the first/last step. Ignored while typing in form fields.

import { Suspense, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
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
    <div className="flex h-full flex-col gap-4">
      <OperationBar
        operations={module.operations}
        settings={module.settings}
        inputForm={module.InputForm}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <DiagramPane module={module} />
        <NarrationPanel />
      </div>

      <StepperControls />
    </div>
  )
}

export function ViewerPage() {
  const { id } = useParams()

  return (
    <ErrorBoundary fallback={<ModuleNotFound id={id} />}>
      <Suspense
        fallback={
          <p className="p-6 text-neutral-500 dark:text-neutral-400" role="status">
            Loading module…
          </p>
        }
      >
        {id ? <ViewerInner key={id} id={id} /> : <ModuleNotFound />}
      </Suspense>
    </ErrorBoundary>
  )
}
