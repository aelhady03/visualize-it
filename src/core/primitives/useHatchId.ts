import { useId } from 'react'

/** A per-instance pattern id that is safe inside `url(#…)` (useId may emit colons). */
export function useHatchId(): string {
  return `viz-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}
