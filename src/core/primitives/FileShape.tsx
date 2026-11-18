// FileShape — an on-disk file, drawn as an SSTable (PLAN.md §3.4).
//
// A page with a folded corner in the `--viz-file` tone. Inside it, optional
// `segments` are the file's data blocks: banded strips (like rows of a
// green-bar printout) labelled with each block's first key, each able to
// carry its own highlight role. Optional `footer` blocks (e.g. ['index',
// 'filter']) draw the metadata an SSTable keeps after its data blocks, with a
// dotted edge so data and metadata never read as the same thing.

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar } from '@core/theme/tokens'
import { RoleRing } from './marks'

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
  /** Data blocks inside the file (e.g. SSTable blocks), left to right. */
  segments?: FileSegment[]
  /** Metadata blocks after the data blocks, e.g. ['index', 'filter']. */
  footer?: string[]
  reducedMotion?: boolean
  children?: ReactNode
}

const CORNER = 10
const INSET = 3
const FOOTER_W = 26

export function FileShape({
  x,
  y,
  width,
  height,
  label,
  layoutId,
  role,
  segments = [],
  footer = [],
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
    'Z',
  ].join(' ')

  const footerW = footer.length * FOOTER_W
  const dataW = width - CORNER - INSET * 2 - footerW
  const segmentWidth = segments.length > 0 ? dataW / segments.length : 0
  const innerY = y + INSET
  const innerH = height - INSET * 2

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      <path
        d={outlinePath}
        fill={fill}
        fillOpacity={0.14}
        stroke={outline}
        strokeWidth={role ? 2 : 1.25}
        strokeLinejoin="round"
      />
      <path d={foldPath} fill={fill} fillOpacity={0.4} stroke={outline} strokeWidth={1} strokeLinejoin="round" />

      {role && (
        <RoleRing x={x} y={y} width={width} height={height} rx={0} role={role} reduced={reduced} d={outlinePath} />
      )}

      {segments.map((segment, i) => {
        const sx = x + INSET + i * segmentWidth
        const segColor = segment.role ? roleVar(segment.role) : fill
        const w = Math.max(1, segmentWidth - 1.5)
        return (
          <g key={i} data-block={i}>
            <rect
              x={sx}
              y={innerY}
              width={w}
              height={innerH}
              rx={1.5}
              fill={segColor}
              fillOpacity={segment.role ? 0.28 : i % 2 === 0 ? 0.2 : 0.1}
              stroke={segColor}
              strokeOpacity={segment.role ? 1 : 0.5}
              strokeWidth={segment.role ? 1.75 : 0.75}
            />
            {segment.label !== undefined && segmentWidth >= 12 && (
              <text
                className="viz-data"
                x={sx + w / 2}
                y={y + height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={9}
                fontWeight={600}
                fill="currentColor"
              >
                {segment.label}
              </text>
            )}
          </g>
        )
      })}

      {footer.map((name, i) => {
        const fx = x + INSET + dataW + i * FOOTER_W + 1
        return (
          <g key={`footer-${name}`} data-footer={name}>
            <path
              d={`M ${fx} ${innerY} h ${FOOTER_W - 2.5} v ${innerH} h ${-(FOOTER_W - 2.5)} Z`}
              fill="none"
              stroke={fill}
              strokeWidth={0.9}
              strokeDasharray="1.5 2"
            />
            <text
              className="viz-label"
              x={fx + (FOOTER_W - 2.5) / 2}
              y={y + height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={7.5}
              fill="currentColor"
              fillOpacity={0.75}
              transform={`rotate(-90 ${fx + (FOOTER_W - 2.5) / 2} ${y + height / 2})`}
            >
              {name}
            </text>
          </g>
        )
      })}

      {label !== undefined && (
        <text
          className="viz-data"
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
