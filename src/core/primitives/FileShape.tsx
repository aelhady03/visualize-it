// FileShape — an on-disk file glyph (PLAN.md §3.4).
//
// A page with a folded corner (the classic "file" silhouette) in the
// `--viz-file` tone, with a label and optional segments: vertical strips that
// let a module sketch the blocks of an SSTable. Segments can carry their own
// highlight roles.

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar } from '@core/theme/tokens'

export interface FileSegment {
  /** Strip label (e.g. a block's first key). */
  label?: string
  role?: Highlight['role']
}

export interface FileShapeProps {
  x: number
  y: number
  width: number
  height: number
  /** File name label, drawn under the shape. */
  label?: string
  /** Namespaced layout id: `${containerId}:${entityId}` (PLAN.md §3.1). */
  layoutId?: string
  role?: Highlight['role']
  /** Vertical strips inside the file (e.g. SSTable blocks). */
  segments?: FileSegment[]
  reducedMotion?: boolean
  children?: ReactNode
}

const CORNER = 10

export function FileShape({
  x,
  y,
  width,
  height,
  label,
  layoutId,
  role,
  segments = [],
  reducedMotion: reducedMotionProp,
  children,
}: FileShapeProps) {
  const systemReduced = useReducedMotion()
  const reduced = reducedMotionProp ?? systemReduced ?? false

  const fill = vizVar('file')
  const roleColor = role ? roleVar(role) : undefined
  const outline = roleColor ?? fill

  // Page outline with a folded top-right corner.
  const outlinePath = [
    `M ${x} ${y}`,
    `L ${x + width - CORNER} ${y}`,
    `L ${x + width} ${y + CORNER}`,
    `L ${x + width} ${y + height}`,
    `L ${x} ${y + height}`,
    'Z',
  ].join(' ')
  const foldPath = [
    `M ${x + width - CORNER} ${y}`,
    `L ${x + width - CORNER} ${y + CORNER}`,
    `L ${x + width} ${y + CORNER}`,
  ].join(' ')

  const segmentWidth = segments.length > 0 ? (width - CORNER - 6) / segments.length : 0

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      <path d={outlinePath} fill={fill} stroke={outline} strokeWidth={role ? 2.5 : 1.25} />
      <path d={foldPath} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.6} />

      {roleColor && (
        <motion.path
          d={outlinePath}
          fill="none"
          stroke={roleColor}
          strokeWidth={2.5}
          style={{ pointerEvents: 'none' }}
          animate={reduced ? undefined : { opacity: [0.2, 0.7, 0.2] }}
          transition={reduced ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {segments.map((segment, i) => {
        const sx = x + 3 + i * segmentWidth
        const segColor = segment.role ? roleVar(segment.role) : 'currentColor'
        return (
          <g key={i}>
            <rect
              x={sx}
              y={y + 3}
              width={Math.max(1, segmentWidth - 1.5)}
              height={height - 6}
              fill="none"
              stroke={segColor}
              strokeWidth={segment.role ? 2 : 1}
              opacity={0.55}
            />
            {segment.label !== undefined && segmentWidth >= 12 && (
              <text
                x={sx + segmentWidth / 2}
                y={y + height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={9}
                fill="currentColor"
              >
                {segment.label}
              </text>
            )}
          </g>
        )
      })}

      {label !== undefined && (
        <text
          x={x + width / 2}
          y={y + height + 14}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
        >
          {label}
        </text>
      )}

      {children}
    </motion.g>
  )
}
