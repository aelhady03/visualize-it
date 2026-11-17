// Shared SVG primitives (PLAN.md §3.4) — re-exported for module authors.
//
// Module authors COMPOSE these primitives; they do not invent their own
// palette (PLAN.md §3.4). All primitives accept a namespaced layoutId
// (PLAN.md §3.1), respect prefers-reduced-motion (no translation, highlight
// only) and use the semantic --viz-* tokens from @core/theme.

export { Box, type BoxProps } from './Box'
export { KeyCell, type KeyCellProps } from './KeyCell'
export { keyCellWidth } from './keyCellWidth'
export { Arrow, type ArrowProps } from './Arrow'
export { BitArray, type BitArrayProps } from './BitArray'
export { FileShape, type FileSegment, type FileShapeProps } from './FileShape'
