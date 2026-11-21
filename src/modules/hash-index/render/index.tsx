/**
 * hash-index Render — the in-memory index on the left, the append-only data
 * file on the right, and one arrow per key pointing from its index entry to
 * the byte offset of its newest record.
 *
 * Entity ids: file entries use their stable `e<seq>` ids; index rows use the
 * derived id `idx:<key>` (engine highlights and render agree — see state.ts).
 * layoutIds are namespaced (PLAN.md §3.1): `index:<key>` for index rows,
 * `index:<key>-link` for their arrows, `file:<id>` for entries.
 *
 * Completion: `useStepTransition` auto-completes identical snapshots and
 * reduced motion; when the snapshot changed, `completeAfter` reports
 * completion once the entry/FLIP duration has passed (same convention as the
 * sstable module).
 */

import { useEffect } from 'react'
import { motion } from 'motion/react'
import type { RenderProps } from '@core/view-contract'
import { Arrow, Box, KeyCell, keyCellWidth } from '@core/primitives'
import { roleVar, vizVar } from '@core/theme/tokens'
import { BASE_DURATION, completeAfter, useStepTransition } from '@core/useStepTransition'
import { entryBytes, indexRowId, staleIds, type FileEntry, type HashIndexState } from '../state'

const PAD = 16
const TOP = 48
const CELL_H = 28
const ROW_STEP = 36
const INDEX_W = 168
const ARROW_LANE = 88
const FILE_X = PAD + INDEX_W + ARROW_LANE
const MIN_FILE_W = 120

interface Placed {
  key: string
  offset: number
  rowY: number
  entry?: FileEntry
}

function layout(state: HashIndexState): { rows: Placed[]; fileW: number; rowsTotal: number } {
  // Index rows in file order (sorted by offset), so the arrows run nearly straight.
  const keys = Object.entries(state.index)
    .sort((a, b) => a[1] - b[1])
    .map(([key, offset]) => ({ key, offset }))
  const byOffset = new Map(state.file.map((e) => [e.offset, e]))
  const rows: Placed[] = keys.map(({ key, offset }, i) => ({
    key,
    offset,
    rowY: TOP + 14 + i * ROW_STEP,
    entry: byOffset.get(offset),
  }))
  let widest = MIN_FILE_W
  for (const entry of state.file) {
    widest = Math.max(widest, keyCellWidth(entry.key, entry.value, entry.seq) + 16)
  }
  return { rows, fileW: widest, rowsTotal: Math.max(rows.length, state.file.length, 1) }
}

export function HashIndexRender(props: RenderProps<HashIndexState>) {
  const { state, prevState, direction, speed, reducedMotion, highlights, onAnimationComplete } =
    props
  const t = useStepTransition({
    state,
    prevState,
    speed,
    direction,
    reducedMotion,
    onAnimationComplete,
  })

  // When something animates (entry/FLIP moves), report completion after the
  // entry duration. The hook already auto-completes the nothing-to-animate
  // cases — arming this then would double-advance the player.
  useEffect(() => {
    if (t.nothingToAnimate) return
    return completeAfter(BASE_DURATION * 1000, speed, reducedMotion, onAnimationComplete)
  }, [state, t.nothingToAnimate, speed, reducedMotion, onAnimationComplete])

  const roles = new Map(highlights.map((h) => [h.id, h.role]))
  const stale = new Set(staleIds(state.file))
  const prevEntryIds = new Set(prevState?.file.map((e) => e.id) ?? [])
  const prevIndexKeys = new Set(prevState === undefined ? [] : Object.keys(prevState.index))

  const { rows, fileW, rowsTotal } = layout(state)
  const boxH = 14 + rowsTotal * ROW_STEP + 10
  const fileBytes = state.file.reduce((sum, e) => sum + entryBytes(e), 0)
  const svgW = FILE_X + fileW + PAD + 8
  const svgH = TOP + boxH + 20

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      role="img"
      aria-label={`Hash index: ${Object.keys(state.index).length} keys in memory, ${fileBytes} bytes on disk`}
    >
      <text x={PAD} y={24} fontSize={13} fontWeight={600} fill="currentColor">
        {`hash index · ${Object.keys(state.index).length} key(s) · file ${fileBytes} bytes · next seq ${state.seq}`}
      </text>

      <text x={PAD} y={TOP - 12} fontSize={11} fill="currentColor" fillOpacity={0.75}>
        in-memory hash index
      </text>
      <text x={FILE_X} y={TOP - 12} fontSize={11} fill="currentColor" fillOpacity={0.75}>
        data file · append-only
      </text>

      <Box
        x={PAD}
        y={TOP}
        width={INDEX_W}
        height={boxH}
        layoutId="index:shape"
        tone="memtable"
        reducedMotion={reducedMotion}
      />
      <Box
        x={FILE_X}
        y={TOP}
        width={fileW}
        height={boxH}
        layoutId="file:shape"
        tone="file"
        reducedMotion={reducedMotion}
      />

      {state.file.length === 0 && (
        <text x={FILE_X + 14} y={TOP + boxH / 2} fontSize={12} fill="currentColor" opacity={0.6}>
          empty file
        </text>
      )}
      {rows.length === 0 && (
        <text x={PAD + 14} y={TOP + boxH / 2} fontSize={12} fill="currentColor" opacity={0.6}>
          empty index
        </text>
      )}

      {state.file.map((entry, i) => {
        const y = TOP + 14 + i * ROW_STEP - 1
        const isNew = prevState !== undefined && !prevEntryIds.has(entry.id)
        const content = (
          <KeyCell
            x={FILE_X + 8}
            y={y}
            label={entry.key}
            value={entry.value}
            seq={entry.seq}
            height={CELL_H}
            layoutId={`file:${entry.id}`}
            tone={entry.tombstone === true ? 'tombstone' : 'wal'}
            role={roles.get(entry.id)}
            reducedMotion={reducedMotion}
          />
        )
        return (
          <g key={entry.id} opacity={stale.has(entry.id) ? 0.5 : 1} data-entity-id={entry.id}>
            {isNew && !reducedMotion ? (
              <motion.g
                initial="exit"
                animate="enter"
                variants={t.variants}
                transition={t.transition}
              >
                {content}
              </motion.g>
            ) : (
              content
            )}
            {stale.has(entry.id) && (
              <line
                x1={FILE_X + 12}
                y1={y + CELL_H / 2}
                x2={FILE_X + 8 + keyCellWidth(entry.key, entry.value, entry.seq) - 4}
                y2={y + CELL_H / 2}
                stroke="currentColor"
                strokeDasharray="3 3"
              />
            )}
          </g>
        )
      })}

      {rows.map(({ key, offset, rowY, entry }) => {
        const midY = rowY + 13
        const isNewRow = prevState !== undefined && !prevIndexKeys.has(key)
        const rowRole = roles.get(indexRowId(key))
        const row = (
          <motion.g layoutId={reducedMotion ? undefined : `index:${key}`}>
            <rect
              x={PAD + 8}
              y={rowY}
              width={INDEX_W - 16}
              height={26}
              rx={3}
              fill={vizVar('memtable')}
              fillOpacity={0.18}
              stroke={rowRole ? roleVar(rowRole) : vizVar('memtable')}
              strokeOpacity={rowRole ? 1 : 0.7}
              strokeWidth={rowRole ? 2 : 1}
            />
            <text
              className="viz-data"
              x={PAD + 14}
              y={midY}
              dominantBaseline="central"
              fontSize={11}
              fontWeight={650}
              fill="currentColor"
            >
              {key}
            </text>
            <text
              className="viz-data"
              x={PAD + INDEX_W - 12}
              y={midY}
              dominantBaseline="central"
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.72}
            >
              →{offset}
            </text>
          </motion.g>
        )
        return (
          <g key={key} data-entity-id={indexRowId(key)}>
            {isNewRow && !reducedMotion ? (
              <motion.g
                initial="exit"
                animate="enter"
                variants={t.variants}
                transition={t.transition}
              >
                {row}
              </motion.g>
            ) : (
              row
            )}
            {entry !== undefined && (
              <Arrow
                from={{ x: PAD + INDEX_W + 4, y: midY }}
                to={{ x: FILE_X + 4, y: TOP + 14 + state.file.indexOf(entry) * ROW_STEP + 13 }}
                layoutId={`index:${key}-link`}
                role={rowRole}
                reducedMotion={reducedMotion}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
