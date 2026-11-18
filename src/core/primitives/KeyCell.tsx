// KeyCell — one key/value record (PLAN.md §3.4).
//
// One entry inside a MemTable, WAL segment, SSTable block or merge stream,
// drawn as a printed record with up to three compartments:
//
//   [ key | value | #seq ]
//
// The key is set bold in the printed (monospace) voice, the value lighter,
// and the sequence number sits in its own small tab so "which version is
// newer" can be read at a glance. A tombstone (tone="tombstone") gets a
// hatched body and a headstone tag on its top edge: shape AND color.
// Highlight roles color the edge and ink in a halo, the same way Box does.

import { motion, useReducedMotion } from 'motion/react'
import type { Highlight } from '@core/engine-contract'
import { roleVar, vizVar, type EntityTone } from '@core/theme/tokens'
import { keyCellLayout } from './keyCellWidth'
import { Headstone, RoleRing, TombstoneHatch } from './marks'
import { useHatchId } from './useHatchId'

export interface KeyCellProps {
  x: number
  y: number
  /** The key (or any short cell text). */
  label: string
  /** Optional value, drawn in its own compartment after the key. */
  value?: string
  /** Optional sequence number tab (e.g. the entry's `seq`). */
  seq?: number | string
  /** Namespaced layout id: `${containerId}:${entityId}` (PLAN.md §3.1). */
  layoutId?: string
  tone?: EntityTone
  role?: Highlight['role']
  /** Explicit cell height; defaults to 24. */
  height?: number
  reducedMotion?: boolean
}

const RADIUS = 3
const TINT = 0.2

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
  const hatchId = useHatchId()

  const { width, valueX, seqX } = keyCellLayout(label, value, seq)
  const tombstone = tone === 'tombstone'
  const fill = tone ? vizVar(tone) : vizVar('surface')
  const roleColor = role ? roleVar(role) : undefined
  const edge = roleColor ?? (tone ? vizVar(tone) : 'currentColor')
  const midY = y + height / 2

  return (
    <motion.g layoutId={reduced ? undefined : layoutId} data-layout-id={reduced ? undefined : layoutId}>
      {tombstone && <TombstoneHatch id={hatchId} />}

      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={RADIUS}
        fill={fill}
        fillOpacity={tone ? TINT : 1}
        stroke={edge}
        strokeOpacity={roleColor ? 1 : tone ? 0.9 : 0.5}
        strokeWidth={role ? 2 : 1}
      />

      {tombstone && (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={RADIUS}
          fill={`url(#${hatchId})`}
          opacity={0.4}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {role && (
        <RoleRing x={x} y={y} width={width} height={height} rx={RADIUS} role={role} reduced={reduced} />
      )}

      {/* Compartment dividers. */}
      {valueX !== undefined && (
        <line
          x1={x + valueX}
          y1={y + 4}
          x2={x + valueX}
          y2={y + height - 4}
          stroke={edge}
          strokeOpacity={0.45}
        />
      )}
      {seqX !== undefined && (
        <line
          x1={x + seqX}
          y1={y + 4}
          x2={x + seqX}
          y2={y + height - 4}
          stroke={edge}
          strokeOpacity={0.45}
          strokeDasharray="2 2"
        />
      )}

      <text
        className="viz-data"
        x={x + 7}
        y={midY}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={650}
        fill="currentColor"
      >
        {label}
      </text>

      {valueX !== undefined && (
        <text
          className="viz-data"
          x={x + valueX + 6}
          y={midY}
          dominantBaseline="central"
          fontSize={11}
          fontWeight={400}
          fill="currentColor"
          fillOpacity={0.82}
        >
          {value}
        </text>
      )}

      {seqX !== undefined && (
        <text
          className="viz-data"
          x={x + seqX + 5}
          y={midY}
          dominantBaseline="central"
          fontSize={8.5}
          fill="currentColor"
          fillOpacity={0.62}
        >
          #{seq}
        </text>
      )}

      {tombstone && <Headstone x={x + width - 16} y={y - 8} size={13} />}
    </motion.g>
  )
}
