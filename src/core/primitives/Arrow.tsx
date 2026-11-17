// Arrow — a directed arrow between two points (PLAN.md §3.4).
//
// Straight shaft with a solid arrowhead, an optional label at the midpoint
// and an optional "flow" animation (marching dashes) that signals data moving
// along the arrow. Flow is disabled under prefers-reduced-motion.

import { motion, useReducedMotion } from 'motion/react'
import type { Highlight } from '@core/engine-contract'
import { roleVar } from '@core/theme/tokens'

export interface ArrowProps {
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** Namespaced layout id: `${containerId}:${entityId}` (PLAN.md §3.1). */
  layoutId?: string
  role?: Highlight['role']
  /** Label drawn near the midpoint. */
  label?: string
  /** Animate marching dashes along the shaft (data in flight). */
  flow?: boolean
  /** Shaft color; defaults to currentColor. */
  color?: string
  reducedMotion?: boolean
}

const HEAD_LENGTH = 8

export function Arrow({
  from,
  to,
  layoutId,
  role,
  label,
  flow = false,
  color,
  reducedMotion: reducedMotionProp,
}: ArrowProps) {
  const systemReduced = useReducedMotion()
  const reduced = reducedMotionProp ?? systemReduced ?? false

  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const angle = Math.atan2(dy, dx)

  // Shaft stops where the arrowhead starts.
  const tipX = to.x - HEAD_LENGTH * Math.cos(angle)
  const tipY = to.y - HEAD_LENGTH * Math.sin(angle)
  const head = [
    `${to.x},${to.y}`,
    `${to.x - HEAD_LENGTH * Math.cos(angle - 0.42)},${to.y - HEAD_LENGTH * Math.sin(angle - 0.42)}`,
    `${to.x - HEAD_LENGTH * Math.cos(angle + 0.42)},${to.y - HEAD_LENGTH * Math.sin(angle + 0.42)}`,
  ].join(' ')

  const stroke = role ? roleVar(role) : (color ?? 'currentColor')
  const shaftProps = {
    x1: from.x,
    y1: from.y,
    x2: tipX,
    y2: tipY,
    stroke,
    strokeWidth: role ? 2.5 : 1.75,
    fill: 'none' as const,
  }

  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      {flow && !reduced ? (
        <motion.line
          {...shaftProps}
          strokeDasharray="4 5"
          animate={{ strokeDashoffset: [-length, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
        />
      ) : (
        <line {...shaftProps} strokeDasharray={flow ? '4 5' : undefined} />
      )}

      <polygon points={head} fill={stroke} />

      {label !== undefined && (
        <text
          x={midX}
          y={midY - 7}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          style={{ pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
    </motion.g>
  )
}
