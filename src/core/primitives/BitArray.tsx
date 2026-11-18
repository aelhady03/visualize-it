// BitArray — a bloom filter's bit array (PLAN.md §3.4).
//
// A row of bit slots: set bits are solid, unset bits are empty slots.
// `highlight` marks the positions a probe hashed to: each gets the role color
// AND a pointer above it (shape, not just color), so a reader can see "hash
// landed here" and whether that bit was set. Every slot keeps its index
// (shown as a tick row under the array) because bloom filters are about
// positions, not values. Each cell carries its own namespaced layoutId so
// cells can FLIP between snapshots.
//
// Vertical extent: probe pointers sit 9px above `y`; with `showIndices` the
// index row ends ~11px below the cells; the caption sits under that.

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
  /** Indices to highlight with the role color (the probe's hash positions). */
  highlight?: number[]
  role?: Extract<Highlight['role'], 'hit' | 'miss' | 'active' | 'new'>
  /** Base layout id; each cell appends `:b<i>` (PLAN.md §3.1 namespacing). */
  layoutId?: string
  /** Caption drawn under the row. */
  label?: string
  /** Draw bit indices under the cells (every 4th when there are more than 8). Defaults to true. */
  showIndices?: boolean
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
  showIndices = true,
  reducedMotion: reducedMotionProp,
}: BitArrayProps) {
  const systemReduced = useReducedMotion()
  const reduced = reducedMotionProp ?? systemReduced ?? false

  const step = cell + gap
  const width = bits.length * step - gap
  const roleColor = roleVar(role)
  const indexEvery = bits.length > 8 ? 4 : 1
  const indexY = y + cell + 9
  const captionY = showIndices ? y + cell + 22 : y + cell + 13

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      {bits.map((bit, i) => {
        const cellX = x + i * step
        const highlighted = highlight.includes(i)
        const cellLayoutId = reduced ? undefined : layoutId ? `${layoutId}:b${i}` : undefined
        return (
          <motion.rect
            key={i}
            layoutId={cellLayoutId}
            data-layout-id={cellLayoutId}
            data-bit={bit ? 1 : 0}
            x={cellX}
            y={y}
            width={cell}
            height={cell}
            rx={1.5}
            fill={highlighted ? roleColor : bit ? vizVar('file') : 'none'}
            fillOpacity={highlighted && !bit ? 0.35 : 1}
            stroke={highlighted ? roleColor : bit ? vizVar('file') : 'currentColor'}
            strokeOpacity={highlighted || bit ? 1 : 0.4}
            strokeWidth={highlighted ? 1.75 : 1}
          />
        )
      })}

      {/* Probe pointers: one per hashed position, above the slot. */}
      {highlight
        .filter((i) => i >= 0 && i < bits.length)
        .map((i) => {
          const cx = x + i * step + cell / 2
          return (
            <polygon
              key={`probe-${i}`}
              data-probe={i}
              points={`${cx - 3.5},${y - 8} ${cx + 3.5},${y - 8} ${cx},${y - 2.5}`}
              fill={roleColor}
            />
          )
        })}

      {showIndices &&
        bits.map((_, i) =>
          i % indexEvery === 0 ? (
            <text
              key={`i-${i}`}
              className="viz-data"
              x={x + i * step + cell / 2}
              y={indexY}
              textAnchor="middle"
              fontSize={7}
              fill="currentColor"
              fillOpacity={0.55}
            >
              {i}
            </text>
          ) : null,
        )}

      {label !== undefined && (
        <text
          className="viz-label"
          x={x + width / 2}
          y={captionY}
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
