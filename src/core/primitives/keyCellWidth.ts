// KeyCell geometry. Lives in its own file so KeyCell.tsx only exports
// components (react-refresh/only-export-components), and so modules can lay
// cells out with exactly the widths KeyCell draws.
//
// A cell is up to three compartments, measured for Recursive in its printed
// (monospace) voice:
//
//   [ key | value | #seq ]

/** Advance of one printed character at the key/value size (11px), in px. */
export const KEY_CHAR = 6.7
/** Advance of one character of the smaller seq tab (8.5px), in px. */
export const SEQ_CHAR = 5.2

export interface KeyCellLayout {
  width: number
  /** x offset (from the cell's left) where the value compartment starts, if any. */
  valueX?: number
  /** x offset where the seq tab starts, if any. */
  seqX?: number
}

export function keyCellLayout(label: string, value?: string, seq?: number | string): KeyCellLayout {
  let w = 7 + label.length * KEY_CHAR + 6
  let valueX: number | undefined
  let seqX: number | undefined
  if (value !== undefined && value !== '') {
    valueX = w
    w += 6 + value.length * KEY_CHAR + 7
  }
  if (seq !== undefined) {
    seqX = w
    w += 5 + (String(seq).length + 1) * SEQ_CHAR + 5
  }
  return { width: Math.max(28, Math.round(w)), valueX, seqX }
}

/** Rendered width of a KeyCell; use it to lay out rows of cells. */
export function keyCellWidth(label: string, value?: string, seq?: number | string): number {
  return keyCellLayout(label, value, seq).width
}
