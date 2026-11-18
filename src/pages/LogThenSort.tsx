// LogThenSort — the module list's opening moment, and the only orchestrated
// animation in the app (core/theme/DESIGN.md).
//
// Five writes append to a log in arrival order, then copies glide down into
// key order: log first, sort second, the idea every storage module builds on.
// It plays once on load. Under reduced motion it renders the end state.

import { motion, useReducedMotion } from 'motion/react'
import { Arrow, KeyCell, keyCellWidth } from '@core/primitives'
import { STEP_EASE } from '@core/useStepTransition'

const WRITES = [
  { key: 'plum', seq: 1 },
  { key: 'cherry', seq: 2 },
  { key: 'mango', seq: 3 },
  { key: 'apple', seq: 4 },
  { key: 'kiwi', seq: 5 },
]

const GAP = 8
const LEFT = 76
const LOG_Y = 14
const SORTED_Y = 92
const CELL_H = 26
const SORT_AT = 2.3

function rowXs(order: typeof WRITES): Map<string, number> {
  const xs = new Map<string, number>()
  let x = LEFT
  for (const w of order) {
    xs.set(w.key, x)
    x += keyCellWidth(w.key, undefined, w.seq) + GAP
  }
  return xs
}

const logX = rowXs(WRITES)
const sorted = [...WRITES].sort((a, b) => a.key.localeCompare(b.key))
const sortedX = rowXs(sorted)
const WIDTH = Math.max(...[...logX.values()].map((x, i) => x + keyCellWidth(WRITES[i].key, undefined, WRITES[i].seq))) + 8
const HEIGHT = SORTED_Y + CELL_H + 8

export function LogThenSort() {
  const reduced = useReducedMotion() ?? false

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="h-auto w-full max-w-[34rem] text-viz-text"
      role="img"
      aria-label="Five keys appended to a log in arrival order, then copied into a table sorted by key."
    >
      <text className="viz-label" x={0} y={LOG_Y + CELL_H / 2} dominantBaseline="central" fontSize={12} fill="currentColor" fillOpacity={0.7}>
        log
      </text>
      <text className="viz-label" x={0} y={SORTED_Y + CELL_H / 2} dominantBaseline="central" fontSize={12} fill="currentColor" fillOpacity={0.7}>
        sorted
      </text>

      {WRITES.map((w, i) => {
        const cell = (
          <KeyCell x={0} y={0} label={w.key} seq={w.seq} tone="wal" height={CELL_H} reducedMotion />
        )
        return reduced ? (
          <g key={`log-${w.key}`} transform={`translate(${logX.get(w.key)} ${LOG_Y})`}>
            {cell}
          </g>
        ) : (
          <motion.g
            key={`log-${w.key}`}
            initial={{ opacity: 0, x: (logX.get(w.key) ?? 0) + 18, y: LOG_Y }}
            animate={{ opacity: 1, x: logX.get(w.key), y: LOG_Y }}
            transition={{ delay: 0.2 + i * 0.32, duration: 0.42, ease: STEP_EASE }}
          >
            {cell}
          </motion.g>
        )
      })}

      {reduced ? (
        <Arrow from={{ x: LEFT - 30, y: LOG_Y + CELL_H + 6 }} to={{ x: LEFT - 30, y: SORTED_Y - 4 }} reducedMotion />
      ) : (
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: SORT_AT - 0.3, duration: 0.3 }}
        >
          <Arrow from={{ x: LEFT - 30, y: LOG_Y + CELL_H + 6 }} to={{ x: LEFT - 30, y: SORTED_Y - 4 }} reducedMotion />
        </motion.g>
      )}

      {WRITES.map((w) => {
        const order = sorted.findIndex((s) => s.key === w.key)
        const cell = (
          <KeyCell x={0} y={0} label={w.key} seq={w.seq} tone="file" height={CELL_H} reducedMotion />
        )
        return reduced ? (
          <g key={`sorted-${w.key}`} transform={`translate(${sortedX.get(w.key)} ${SORTED_Y})`}>
            {cell}
          </g>
        ) : (
          <motion.g
            key={`sorted-${w.key}`}
            initial={{ opacity: 0, x: logX.get(w.key), y: LOG_Y }}
            animate={{ opacity: 1, x: sortedX.get(w.key), y: SORTED_Y }}
            transition={{ delay: SORT_AT + order * 0.09, duration: 0.75, ease: STEP_EASE }}
          >
            {cell}
          </motion.g>
        )
      })}
    </svg>
  )
}
