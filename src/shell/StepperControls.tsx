// StepperControls — the transport under the diagram (PLAN.md §3.3, §4):
// step back, play/pause, step forward, next chapter, a scrub bar with chapter
// marks, a step counter, speed 0.25x–2x, undo and reset.
//
// All state and actions come from the player store; every control is
// disabled gracefully while there are no steps (or nothing to undo).

import { usePlayerStore } from '@core/player/store'

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 2.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1L5.4 1.7a.6.6 0 0 0-.9.5z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="2" width="3.2" height="12" rx="0.8" fill="currentColor" />
      <rect x="9.3" y="2" width="3.2" height="12" rx="0.8" fill="currentColor" />
    </svg>
  )
}

function StepBackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="2.2" height="11" rx="0.6" fill="currentColor" />
      <path d="M13.5 3v10a.5.5 0 0 1-.8.4L6.4 8.4a.5.5 0 0 1 0-.8l6.3-5a.5.5 0 0 1 .8.4z" fill="currentColor" />
    </svg>
  )
}

function StepForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="11.3" y="2.5" width="2.2" height="11" rx="0.6" fill="currentColor" />
      <path d="M2.5 3v10a.5.5 0 0 0 .8.4l6.3-5a.5.5 0 0 0 0-.8l-6.3-5a.5.5 0 0 0-.8.4z" fill="currentColor" />
    </svg>
  )
}

function ChapterIcon() {
  return (
    <svg width="15" height="14" viewBox="0 0 17 16" aria-hidden="true">
      <path d="M1.5 3v10a.5.5 0 0 0 .8.4l5.6-5a.5.5 0 0 0 0-.8l-5.6-5a.5.5 0 0 0-.8.4z" fill="currentColor" />
      <path d="M8.5 3v10a.5.5 0 0 0 .8.4l5.6-5a.5.5 0 0 0 0-.8l-5.6-5a.5.5 0 0 0-.8.4z" fill="currentColor" />
      <rect x="15" y="2.5" width="1.6" height="11" rx="0.5" fill="currentColor" />
    </svg>
  )
}

const KEY_CLASS =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-rule bg-paper px-2 text-ink transition-colors enabled:hover:border-pen enabled:hover:text-pen enabled:active:translate-y-px disabled:opacity-35'

const TEXT_BUTTON_CLASS =
  'inline-flex h-9 items-center rounded-md px-2.5 text-[0.875rem] text-ink-soft transition-colors enabled:hover:bg-band enabled:hover:text-ink disabled:opacity-35'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

export function StepperControls() {
  const { steps, chapters, index, speed, playing, historyLength, actions } = usePlayerStore()

  const count = steps.length
  const empty = count === 0
  const max = Math.max(0, count - 1)
  // The store uses index -1 when there is no timeline to show.
  const clampedIndex = Math.max(0, Math.min(index, max))
  const nextChapter = chapters.find((c) => c.start > clampedIndex)
  const canReset = !empty || historyLength > 0
  const progress = max === 0 ? 0 : (clampedIndex / max) * 100

  return (
    <div
      role="group"
      aria-label="Playback controls"
      className="flex flex-wrap items-center gap-x-3 gap-y-3 px-1 pt-3"
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={KEY_CLASS}
          onClick={actions.stepBack}
          disabled={empty || clampedIndex === 0}
          aria-label="Step back"
          title="Step back (←)"
        >
          <StepBackIcon />
        </button>

        <button
          type="button"
          className="inline-flex h-9 w-12 items-center justify-center rounded-md bg-pen text-pen-ink transition-[filter,transform] enabled:hover:brightness-110 enabled:active:translate-y-px disabled:opacity-35"
          onClick={playing ? actions.pause : actions.play}
          disabled={empty}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          type="button"
          className={KEY_CLASS}
          onClick={actions.stepForward}
          disabled={empty || clampedIndex >= max}
          aria-label="Step forward"
          title="Step forward (→)"
        >
          <StepForwardIcon />
        </button>

        <button
          type="button"
          className={KEY_CLASS}
          onClick={actions.fastForwardChapter}
          disabled={!nextChapter}
          aria-label="Fast-forward to next chapter"
          title={nextChapter ? `Skip to the next chapter: ${nextChapter.label}` : 'This is the last chapter'}
        >
          <ChapterIcon />
        </button>
      </div>

      <div className="order-last flex min-w-0 basis-full items-center gap-3 sm:order-none sm:basis-auto sm:flex-1">
        <div className="relative min-w-32 flex-1">
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={clampedIndex}
            disabled={empty}
            onChange={(e) => actions.scrubTo(Number(e.target.value))}
            aria-label="Timeline"
            aria-valuetext={empty ? 'No steps' : `Step ${clampedIndex + 1} of ${count}`}
            className="scrubber w-full"
            style={{ '--progress': `${progress}%` } as React.CSSProperties}
          />
          {!empty &&
            max > 0 &&
            chapters
              .filter((chapter) => chapter.start > 0 && chapter.end > chapter.start)
              .map((chapter) => (
                <span
                  key={`${chapter.start}-${chapter.end}`}
                  title={chapter.label}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-soft/70"
                  style={{ left: `calc(4px + (100% - 8px) * ${chapter.start / max})` }}
                />
              ))}
        </div>
        <output
          className="voice-printed w-[4.5rem] shrink-0 text-right text-[0.875rem] tabular-nums text-ink-soft"
          aria-label="Step counter"
        >
          {empty ? '–' : (
            <>
              <span className="text-ink">{String(clampedIndex + 1).padStart(2, '0')}</span>/
              {String(count).padStart(2, '0')}
            </>
          )}
        </output>
      </div>

      <div className="flex items-center gap-1">
        <label className="flex items-center gap-1.5 pr-1 text-[0.875rem] text-ink-soft">
          <span>Speed</span>
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => actions.setSpeed(Number(e.target.value))}
            className="voice-printed h-9 rounded-md border border-rule bg-paper px-1.5 text-[0.875rem] text-ink"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={TEXT_BUTTON_CLASS}
          onClick={actions.undo}
          disabled={historyLength === 0}
          aria-label="Undo last run"
          title="Undo the last run and restore the state before it"
        >
          Undo run
        </button>

        <button
          type="button"
          className={TEXT_BUTTON_CLASS}
          onClick={actions.reset}
          disabled={!canReset}
          aria-label="Reset to initial state"
          title="Clear every run and start from the initial state"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
