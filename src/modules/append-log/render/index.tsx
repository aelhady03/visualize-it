/**
 * append-log Render — the log as a row of KeyCells inside one file Box,
 * oldest on the left, with an "append" arrow at the tail.
 *
 * Entity ids are the entries' stable `e<seq>` ids; layoutIds are namespaced
 * `log:<id>` (PLAN.md §3.1), so survivors slide left after compaction.
 * Completion: `useStepTransition` auto-completes when nothing animates
 * (identical snapshot or reduced motion); otherwise a zero-size sentinel,
 * remounted per snapshot, runs one entry-duration animation and reports
 * `onAnimationComplete` exactly once.
 */

import { motion } from 'motion/react'
import type { RenderProps } from '@core/view-contract'
import { Arrow, Box, KeyCell, keyCellWidth } from '@core/primitives'
import { useStepTransition } from '@core/useStepTransition'
import { staleIds, type AppendLogState } from '../state'

const PAD = 16
const GAP = 8
const CELL_H = 28
const ROW_H = CELL_H + 14
const MAX_ROW_W = 520
const TOP = 40

interface Placed {
  id: string
  x: number
  y: number
  w: number
}

function layout(state: AppendLogState): { cells: Placed[]; width: number; rows: number } {
  const cells: Placed[] = []
  let x = PAD + 8
  let row = 0
  let widest = 0
  for (const entry of state.entries) {
    const w = keyCellWidth(entry.key, entry.value, entry.seq)
    if (x + w > PAD + 8 + MAX_ROW_W && x > PAD + 8) {
      row += 1
      x = PAD + 8
    }
    cells.push({ id: entry.id, x, y: TOP + 12 + row * ROW_H, w })
    x += w + GAP
    widest = Math.max(widest, x)
  }
  return { cells, width: Math.max(widest, 240), rows: row + 1 }
}

export function AppendLogRender(props: RenderProps<AppendLogState>) {
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

  const roles = new Map(highlights.map((h) => [h.id, h.role]))
  const stale = new Set(staleIds(state.entries))
  const prevIds = new Set(prevState?.entries.map((e) => e.id) ?? [])
  const { cells, width: contentW, rows } = layout(state)
  const boxW = contentW - PAD + 8
  const boxH = 24 + rows * ROW_H
  const svgW = PAD + boxW + 70
  const svgH = TOP + boxH + 24
  const last = cells.at(-1)
  const tailX = last ? last.x + last.w + 6 : PAD + 14
  const tailY = last ? last.y + CELL_H / 2 : TOP + 12 + CELL_H / 2

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      role="img"
      aria-label={`Append-only log with ${state.entries.length} entries`}
    >
      <text x={PAD} y={TOP - 10} fontSize={12} fill="currentColor">
        log file · {state.entries.length} entries · {stale.size} stale · next seq {state.seq}
      </text>
      <Box
        x={PAD}
        y={TOP}
        width={boxW}
        height={boxH}
        layoutId="log:file"
        tone="file"
        reducedMotion={reducedMotion}
      />
      {state.entries.length === 0 && (
        <text x={tailX + 64} y={tailY + 4} fontSize={12} fill="currentColor" opacity={0.6}>
          empty log
        </text>
      )}
      {state.entries.map((entry, i) => {
        const cell = cells[i]
        const isNew = prevState !== undefined && !prevIds.has(entry.id)
        const content = (
          <KeyCell
            x={cell.x}
            y={cell.y}
            label={entry.key}
            value={entry.value}
            seq={entry.seq}
            height={CELL_H}
            layoutId={`log:${entry.id}`}
            tone="wal"
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
                x1={cell.x + 4}
                y1={cell.y + CELL_H / 2}
                x2={cell.x + cell.w - 4}
                y2={cell.y + CELL_H / 2}
                stroke="currentColor"
                strokeDasharray="3 3"
              />
            )}
          </g>
        )
      })}
      <Arrow
        from={{ x: tailX + 52, y: tailY }}
        to={{ x: tailX, y: tailY }}
        label="append"
        layoutId="log:tail"
        reducedMotion={reducedMotion}
      />
      {!t.nothingToAnimate && (
        <motion.rect
          key={JSON.stringify(state)}
          width={0}
          height={0}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t.transition}
          onAnimationComplete={onAnimationComplete}
        />
      )}
    </svg>
  )
}
