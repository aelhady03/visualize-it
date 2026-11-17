// KeyCell — a compact key/value cell (PLAN.md §3.4).
//
// One entry inside a MemTable, WAL segment or merge stream: a rounded cell
// with the key, an optional value ("k → v") and an optional sequence-number
// badge. Highlight roles color the outline the same way Box does.

import { motion, useReducedMotion } from 'motion/react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar, type EntityTone } from '@core/theme/tokens'
import { keyCellWidth } from './keyCellWidth'

export interface KeyCellProps {
  x: number
  y: number
  /** The key (or any short cell text). */
  label: string
  /** Optional value shown as "label → value". */
  value?: string
  /** Optional sequence number badge (e.g. the entry's `seq`). */
  seq?: number | string
  /** Namespaced layout id: `${containerId}:${entityId}` (PLAN.md §3.1). */
  layoutId?: string
  tone?: EntityTone
  role?: Highlight['role']
  /** Explicit cell height; defaults to 24. */
  height?: number
  reducedMotion?: boolean
}

export function KeyCell({
  x,
  y,
  label,
  value,
  seq,
  layoutId,
  tone,
  role,
  height = 24,
  reducedMotion: reducedMotionProp,
}: KeyCellProps) {
  const systemReduced = useReducedMotion()
  const reduced = reducedMotionProp ?? systemReduced ?? false

  const width = keyCellWidth(label, value, seq)
  const fill = tone ? vizVar(tone) : 'none'
  const roleColor = role ? roleVar(role) : undefined
  const stroke = roleColor ?? 'currentColor'
  const text = value !== undefined ? `${label}→${value}` : label

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={fill}
        stroke={stroke}
        strokeWidth={role ? 2 : 1}
      />

      {roleColor && (
        <motion.rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={4}
          fill="none"
          stroke={roleColor}
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
          animate={reduced ? undefined : { opacity: [0.2, 0.7, 0.2] }}
          transition={reduced ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <text
        x={x + 7}
        y={y + height / 2}
        dominantBaseline="central"
        fontSize={11}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill="currentColor"
      >
        {text}
      </text>

      {seq !== undefined && (
        <text
          x={x + width - 5}
          y={y + 3.5}
          textAnchor="end"
          fontSize={8}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fill="currentColor"
          opacity={0.65}
        >
          #{seq}
        </text>
      )}
    </motion.g>
  )
}
