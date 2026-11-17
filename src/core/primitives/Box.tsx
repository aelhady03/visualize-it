// Box — the generic container primitive (PLAN.md §3.4).
//
// A rectangle with an optional entity tone (fill color), highlight role
// (colored outline + pulse), pattern overlay (tombstone cross / removed
// dashes), centered label and arbitrary SVG children.
//
// Animation convention (PLAN.md §3.1): pass a NAMESPACED layoutId
// (`${containerId}:${entityId}`) and motion will FLIP-animate the box between
// snapshots. Under prefers-reduced-motion the layoutId is dropped (no
// translation) and the role highlight becomes a static outline.

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar, type EntityTone } from '@core/theme/tokens'

export interface BoxProps {
  x: number
  y: number
  width: number
  height: number
  /** Namespaced layout id: `${containerId}:${entityId}` (PLAN.md §3.1). */
  layoutId?: string
  /** Entity-kind fill color. `undefined` renders an unfilled outline box. */
  tone?: EntityTone
  /** Highlight role: colored outline, pulsing unless motion is reduced. */
  role?: Highlight['role']
  /** Surface pattern. 'tombstone' differs by shape AND color (colorblind-safe). */
  pattern?: 'none' | 'tombstone' | 'removed'
  /** Centered label. */
  label?: string
  /** Override the system reduced-motion preference (mainly for tests). */
  reducedMotion?: boolean
  children?: ReactNode
}

export function Box({
  x,
  y,
  width,
  height,
  layoutId,
  tone,
  role,
  pattern = 'none',
  label,
  reducedMotion: reducedMotionProp,
  children,
}: BoxProps) {
  const systemReduced = useReducedMotion()
  const reduced = reducedMotionProp ?? systemReduced ?? false

  const fill = tone ? vizVar(tone) : 'none'
  const roleColor = role ? roleVar(role) : undefined
  const stroke = roleColor ?? 'currentColor'
  const strokeWidth = role ? 2.5 : 1.25

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
        strokeWidth={strokeWidth}
        strokeDasharray={pattern === 'removed' ? '5 4' : undefined}
      />

      {pattern === 'tombstone' && (
        // Diagonal cross: the shape/pattern half of the tombstone distinction.
        <path
          d={`M ${x + width * 0.25} ${y + height * 0.25} L ${x + width * 0.75} ${y + height * 0.75} M ${x + width * 0.75} ${y + height * 0.25} L ${x + width * 0.25} ${y + height * 0.75}`}
          stroke={fill}
          strokeWidth={1.75}
          strokeLinecap="round"
          fill="none"
        />
      )}

      {roleColor && (
        <motion.rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={4}
          fill="none"
          stroke={roleColor}
          strokeWidth={2.5}
          style={{ pointerEvents: 'none' }}
          animate={reduced ? undefined : { opacity: [0.2, 0.7, 0.2] }}
          transition={reduced ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {label !== undefined && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fill="currentColor"
        >
          {label}
        </text>
      )}

      {children}
    </motion.g>
  )
}
