// Shared marks for the primitives (internal, not re-exported from index.ts):
//
// - RoleRing: the highlight treatment. A halo drawn outside the shape that
//   inks in once when the role appears ("this changed"), instead of a pulse
//   that loops forever. Only `active` (work in progress) keeps breathing.
// - TombstoneHatch: a <pattern> of diagonal hatching in the tombstone color.
// - Headstone: the tombstone glyph, a rounded slab with a cross. Together
//   with the hatch it makes tombstones differ by SHAPE and color.

import { motion } from 'motion/react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar } from '@core/theme/tokens'

/** Halo offset outside the shape, in px. */
const RING_GAP = 3

export function RoleRing({
  x,
  y,
  width,
  height,
  rx,
  role,
  reduced,
  d,
}: {
  x: number
  y: number
  width: number
  height: number
  rx: number
  role: Highlight['role']
  reduced: boolean
  /** Optional path (e.g. a file outline) instead of a rect. */
  d?: string
}) {
  const color = roleVar(role)
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 1.5,
    style: { pointerEvents: 'none' as const },
  }
  if (reduced) {
    return d ? (
      <path d={d} {...common} opacity={0.5} />
    ) : (
      <rect
        x={x - RING_GAP}
        y={y - RING_GAP}
        width={width + RING_GAP * 2}
        height={height + RING_GAP * 2}
        rx={rx + RING_GAP}
        {...common}
        opacity={0.5}
      />
    )
  }

  const breathing = role === 'active'
  const animate = breathing
    ? { pathLength: 1, opacity: [0.25, 0.75, 0.25] }
    : { pathLength: 1, opacity: 0.55 }
  const transition = breathing
    ? {
        pathLength: { duration: 0.35, ease: 'easeOut' as const },
        opacity: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' as const },
      }
    : { duration: 0.35, ease: 'easeOut' as const }

  return d ? (
    <motion.path
      d={d}
      {...common}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={animate}
      transition={transition}
    />
  ) : (
    <motion.rect
      x={x - RING_GAP}
      y={y - RING_GAP}
      width={width + RING_GAP * 2}
      height={height + RING_GAP * 2}
      rx={rx + RING_GAP}
      {...common}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={animate}
      transition={transition}
    />
  )
}

/** Diagonal hatch in the tombstone color; reference it as `url(#${id})` (see useHatchId). */
export function TombstoneHatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M 0 0 L 0 5" stroke={vizVar('tombstone')} strokeWidth={1.4} />
      </pattern>
    </defs>
  )
}

/** The headstone glyph, its bottom-left corner at (x, y + h). */
export function Headstone({ x, y, size = 10 }: { x: number; y: number; size?: number }) {
  const w = size * 0.8
  const r = w / 2
  const h = size
  const cx = x + r
  return (
    <g aria-hidden="true" data-glyph="tombstone">
      <path
        d={`M ${x} ${y + h} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h} Z`}
        fill={vizVar('tombstone')}
        stroke={vizVar('surface')}
        strokeWidth={1}
      />
      <path
        d={`M ${cx} ${y + h * 0.3} L ${cx} ${y + h * 0.78} M ${cx - w * 0.24} ${y + h * 0.48} L ${cx + w * 0.24} ${y + h * 0.48}`}
        stroke={vizVar('surface')}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
    </g>
  )
}
