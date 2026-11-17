// BitArray — a row of bit cells (PLAN.md §3.4).
//
// Renders a fixed-length bit array (a bloom filter) as small squares: set
// bits are filled, unset bits are outlined. Indices in `highlight` get the
// role color (e.g. the hash positions a bloom probe touched). Each cell
// carries its own namespaced layoutId so cells can FLIP between snapshots.

import { motion, useReducedMotion } from 'motion/react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar } from '@core/theme/tokens'

export interface BitArrayProps {
  x: number
  y: number
  /** Bit values: 1 = set, 0 = unset. Length = number of cells. */
  bits: number[]
  /** Cell side length in px; defaults to 10. */
  cell?: number
  /** Gap between cells in px; defaults to 2. */
  gap?: number
  /** Indices to highlight with the role color. */
  highlight?: number[]
  role?: Extract<Highlight['role'], 'hit' | 'miss' | 'active' | 'new'>
  /** Base layout id; each cell appends `:b<i>` (PLAN.md §3.1 namespacing). */
  layoutId?: string
  /** Caption drawn under the row. */
  label?: string
  reducedMotion?: boolean
}

export function BitArray({
  x,
  y,
  bits,
  cell = 10,
  gap = 2,
  highlight = [],
  role = 'hit',
  layoutId,
  label,
  reducedMotion: reducedMotionProp,
}: BitArrayProps) {
  const systemReduced = useReducedMotion()
  const reduced = reducedMotionProp ?? systemReduced ?? false

  const step = cell + gap
  const width = bits.length * step - gap
  const roleColor = roleVar(role)

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      {bits.map((bit, i) => {
        const cellX = x + i * step
        const highlighted = highlight.includes(i)
        return (
          <motion.rect
            key={i}
            layoutId={reduced ? undefined : layoutId ? `${layoutId}:b${i}` : undefined}
            data-layout-id={reduced ? undefined : layoutId ? `${layoutId}:b${i}` : undefined}
            x={cellX}
            y={y}
            width={cell}
            height={cell}
            rx={1.5}
            fill={highlighted ? roleColor : bit ? vizVar('file') : 'none'}
            stroke={highlighted ? roleColor : 'currentColor'}
            strokeWidth={highlighted ? 1.75 : 1}
          />
        )
      })}

      {label !== undefined && (
        <text
          x={x + width / 2}
          y={y + cell + 13}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
        >
          {label}
        </text>
      )}
    </motion.g>
  )
}
