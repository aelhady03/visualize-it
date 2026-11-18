// Arrow — a directed arrow between two points (PLAN.md §3.4).
//
// A round-capped shaft ending in a notched, swept arrowhead that reads at any
// zoom, an optional label at the midpoint (knocked out of the lines behind
// it with a surface-colored halo) and an optional "flow" animation (marching
// dashes) that signals data moving along the arrow. Flow is disabled under
// prefers-reduced-motion.

import { motion, useReducedMotion } from 'motion/react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar } from '@core/theme/tokens'

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

const HEAD_LENGTH = 10
const HEAD_SPREAD = 0.42
/** How far the notch at the back of the head reaches toward the tip (0–1). */
const NOTCH = 0.3

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
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  // Shaft stops inside the notch, so the round cap hides under the head.
  const shaftEnd = HEAD_LENGTH * (1 - NOTCH) + 0.5
  const tipX = to.x - shaftEnd * cos
  const tipY = to.y - shaftEnd * sin
  const notchX = to.x - HEAD_LENGTH * (1 - NOTCH) * cos
  const notchY = to.y - HEAD_LENGTH * (1 - NOTCH) * sin
  const head = [
    `${to.x},${to.y}`,
    `${to.x - HEAD_LENGTH * Math.cos(angle - HEAD_SPREAD)},${to.y - HEAD_LENGTH * Math.sin(angle - HEAD_SPREAD)}`,
    `${notchX},${notchY}`,
    `${to.x - HEAD_LENGTH * Math.cos(angle + HEAD_SPREAD)},${to.y - HEAD_LENGTH * Math.sin(angle + HEAD_SPREAD)}`,
  ].join(' ')

  const stroke = role ? roleVar(role) : (color ?? 'currentColor')
  const shaftProps = {
    x1: from.x,
    y1: from.y,
    x2: tipX,
    y2: tipY,
    stroke,
    strokeWidth: role ? 2.25 : 1.5,
    strokeLinecap: 'round' as const,
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
          animate={{ strokeDashoffset: [length, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
        />
      ) : (
        <line {...shaftProps} strokeDasharray={flow ? '4 5' : undefined} />
      )}

      <polygon points={head} fill={stroke} stroke={stroke} strokeWidth={0.75} strokeLinejoin="round" />

      {label !== undefined && (
        <text
          className="viz-label"
          x={midX}
          y={midY - 7}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight={500}
          fill="currentColor"
          stroke={vizVar('surface')}
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
    </motion.g>
  )
}
