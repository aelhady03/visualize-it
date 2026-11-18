// Difficulty — a three-step level mark (beginner / intermediate / advanced).
//
// Three cues that agree: color (the --level-* ramp in theme.css: green,
// ochre, vermilion), shape (one, two or three filled steps) and the word.
// Color is never the only signal: the steps and the word read the same for
// every reader. The word is always available to assistive tech (and as a
// tooltip), and shown next to the mark when `showLabel` is set.

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const

const LEVEL_COLOR: Record<(typeof LEVELS)[number], string> = {
  beginner: 'text-level-beginner',
  intermediate: 'text-level-intermediate',
  advanced: 'text-level-advanced',
}

export function Difficulty({ level, showLabel = false }: { level: string; showLabel?: boolean }) {
  const known = LEVELS.find((l) => l === level)
  const filled = known ? LEVELS.indexOf(known) + 1 : 1
  const color = known ? LEVEL_COLOR[known] : 'text-ink-soft'
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${color}`}
      title={`Level: ${level}`}
      data-level={known ?? 'unknown'}
    >
      <svg width="13" height="11" viewBox="0 0 13 11" aria-hidden="true" className="shrink-0">
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={i * 4.5}
            y={7 - i * 3.5}
            width={3.5}
            height={4 + i * 3.5}
            rx={0.75}
            fill="currentColor"
            fillOpacity={i < filled ? 1 : 0.22}
          />
        ))}
      </svg>
      {showLabel ? (
        <span className="text-[0.8125rem] font-[600] capitalize">{level}</span>
      ) : (
        <span className="sr-only">{level}</span>
      )}
    </span>
  )
}
