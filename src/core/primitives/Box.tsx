// Box — the generic container primitive (PLAN.md §3.4).
//
// A rectangle with an optional entity tone, highlight role, pattern overlay
// (tombstone hatch + headstone glyph / removed dashes), centered label and
// arbitrary SVG children.
//
// Look (see core/theme/DESIGN.md): the tone is a light tint with a
// full-strength edge, so ribbon-ink text stays legible on top. A role adds a
// halo outside the edge that inks in once; only `active` keeps breathing.
//
// Animation convention (PLAN.md §3.1): pass a NAMESPACED layoutId
// (`${containerId}:${entityId}`) and motion will FLIP-animate the box between
// snapshots. Under prefers-reduced-motion the layoutId is dropped (no
// translation) and the role halo is static.

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar, type EntityTone } from '@core/theme/tokens'
import { Headstone, RoleRing, TombstoneHatch } from './marks'
import { useHatchId } from './useHatchId'

export interface BoxProps {
  x: number
  y: number
  width: number
  height: number
  /** Namespaced layout id: `${containerId}:${entityId}` (PLAN.md §3.1). */
  layoutId?: string
  /** Entity-kind tint. `undefined` renders an unfilled outline box. */
  tone?: EntityTone
  /** Highlight role: colored edge + halo. */
  role?: Highlight['role']
  /** Surface pattern. 'tombstone' differs by shape AND color (colorblind-safe). */
  pattern?: 'none' | 'tombstone' | 'removed'
  /** Centered label. */
  label?: string
  /** Corner radius; defaults to 5. Containers read larger than the cells inside them. */
  radius?: number
  /** Override the system reduced-motion preference (mainly for tests). */
  reducedMotion?: boolean
  children?: ReactNode
}

/** Tint strength of a toned fill. */
const TINT = 0.16

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
  radius = 5,
  reducedMotion: reducedMotionProp,
  children,
}: BoxProps) {
  const systemReduced = useReducedMotion()
  const reduced = reducedMotionProp ?? systemReduced ?? false
  const hatchId = useHatchId()

  const fill = tone ? vizVar(tone) : 'none'
  const roleColor = role ? roleVar(role) : undefined
  const edge = roleColor ?? (tone ? vizVar(tone) : 'currentColor')

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      {pattern === 'tombstone' && <TombstoneHatch id={hatchId} />}

      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        fill={fill}
        fillOpacity={pattern === 'removed' ? TINT / 2 : TINT}
        stroke={edge}
        strokeOpacity={roleColor ? 1 : tone ? 0.85 : 0.45}
        strokeWidth={role ? 2 : 1.25}
        strokeDasharray={pattern === 'removed' ? '5 4' : undefined}
      />

      {pattern === 'tombstone' && (
        <>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={radius}
            fill={`url(#${hatchId})`}
            opacity={0.45}
            style={{ pointerEvents: 'none' }}
          />
          {height >= 16 && <Headstone x={x + 5} y={y + 4} size={Math.min(12, height - 8)} />}
        </>
      )}

      {role && (
        <RoleRing x={x} y={y} width={width} height={height} rx={radius} role={role} reduced={reduced} />
      )}

      {label !== undefined && (
        <text
          className="viz-label"
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={550}
          fill="currentColor"
        >
          {label}
        </text>
      )}

      {children}
    </motion.g>
  )
}
