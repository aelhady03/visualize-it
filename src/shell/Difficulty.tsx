// Difficulty — a three-step level mark (beginner / intermediate / advanced).
//
// Shape, not color: one, two or three filled steps, so it reads the same for
// every reader. The word is always available to assistive tech, and shown
// next to the mark when `showLabel` is set.

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const

export function Difficulty({ level, showLabel = false }: { level: string; showLabel?: boolean }) {
  const filled = Math.max(1, LEVELS.indexOf(level as (typeof LEVELS)[number]) + 1)
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-soft" title={`Level: ${level}`}>
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
        <span className="text-[0.8125rem] capitalize">{level}</span>
      ) : (
        <span className="sr-only">{level}</span>
      )}
    </span>
  )
}
