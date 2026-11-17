// StepperControls — the playback bar (PLAN.md §3.3, §4): play/pause, step
// back/forward, scrub bar with chapter markers, speed 0.25x–2x,
// fast-forward-to-next-chapter, undo and reset.
//
// All state and actions come from the player store; every control is
// disabled gracefully while there are no steps (or nothing to undo).

import { usePlayerStore } from '@core/player/store'

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2l10 6-10 6z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 2h4v12H3zM9 2h4v12H9z" fill="currentColor" />
    </svg>
  )
}

function StepBackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 2h2.5v12H3z" fill="currentColor" />
      <path d="M13.5 2L7.5 8l6 6z" fill="currentColor" />
    </svg>
  )
}

function StepForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 2h2.5v12h-2.5z" fill="currentColor" />
      <path d="M2.5 2l6 6-6 6z" fill="currentColor" />
    </svg>
  )
}

function ChapterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2l5 6-5 6z" fill="currentColor" />
      <path d="M9 2l5 6-5 6z" fill="currentColor" />
    </svg>
  )
}

const BUTTON_CLASS =
  'inline-flex h-8 items-center justify-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800 transition-colors enabled:hover:border-sky-400 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

export function StepperControls() {
  const { steps, chapters, index, speed, playing, historyLength, actions } = usePlayerStore()

  const count = steps.length
  const empty = count === 0
  const max = Math.max(0, count - 1)
  const clampedIndex = Math.min(index, max)
  const nextChapter = chapters.find((c) => c.start > clampedIndex)
  const canReset = !empty || historyLength > 0

  return (
    <div
      role="group"
      aria-label="Playback controls"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={actions.stepBack}
        disabled={empty || clampedIndex === 0}
        aria-label="Step back"
        title="Step back (←)"
      >
        <StepBackIcon />
      </button>

      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={playing ? actions.pause : actions.play}
        disabled={empty}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={actions.stepForward}
        disabled={empty || clampedIndex >= max}
        aria-label="Step forward"
        title="Step forward (→)"
      >
        <StepForwardIcon />
      </button>

      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={actions.fastForwardChapter}
        disabled={!nextChapter}
        aria-label="Fast-forward to next chapter"
        title={nextChapter ? `Fast-forward to chapter: ${nextChapter.label}` : 'No next chapter'}
      >
        <ChapterIcon />
      </button>

      <div className="relative mx-1 min-w-40 flex-1">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={clampedIndex}
          disabled={empty}
          onChange={(e) => actions.scrubTo(Number(e.target.value))}
          aria-label="Timeline"
          className="h-2 w-full cursor-pointer accent-sky-600 disabled:cursor-default"
        />
        {!empty &&
          chapters.map((chapter) => (
            <span
              key={`${chapter.start}-${chapter.end}`}
              title={chapter.label}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-neutral-400 dark:bg-neutral-500"
              style={{ left: `${(chapter.start / max) * 100}%` }}
            />
          ))}
      </div>

      <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
        <span className="text-xs">Speed</span>
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => actions.setSpeed(Number(e.target.value))}
          className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
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
        className={BUTTON_CLASS}
        onClick={actions.undo}
        disabled={historyLength === 0}
        aria-label="Undo last run"
        title="Undo last run"
      >
        Undo
      </button>

      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={actions.reset}
        disabled={!canReset}
        aria-label="Reset to initial state"
        title="Reset to initial state"
      >
        Reset
      </button>
    </div>
  )
}
