// Semantic visualization tokens for JS/SVG access (PLAN.md §3.4).
//
// The light/dark VALUES live in theme.css as CSS custom properties and flip
// with `prefers-color-scheme`. This file maps the token keys to their CSS
// variable references so modules and primitives can use them in SVG
// attributes (fill/stroke) without hard-coding colors.
//
// Import the CSS once, at app entry (src/main.tsx imports theme.css).

import type { Highlight } from '../engine-contract'

export const VIZ_TOKEN_KEYS = [
  'wal',
  'memtable',
  'file',
  'tombstone',
  'hit',
  'miss',
  'active',
  'new',
  'removed',
] as const

export type VizTokenKey = (typeof VIZ_TOKEN_KEYS)[number]

/** Entity kinds that can carry a `tone` on the shared primitives. */
export type EntityTone = 'wal' | 'memtable' | 'file' | 'tombstone'

/** CSS variable reference for a semantic token: vizVar('wal') → 'var(--viz-wal)'. */
export function vizVar(key: VizTokenKey): string {
  return `var(--viz-${key})`
}

/** Token key → CSS variable reference, one entry per semantic token. */
export const vizTokens: Readonly<Record<VizTokenKey, string>> = {
  wal: vizVar('wal'),
  memtable: vizVar('memtable'),
  file: vizVar('file'),
  tombstone: vizVar('tombstone'),
  hit: vizVar('hit'),
  miss: vizVar('miss'),
  active: vizVar('active'),
  new: vizVar('new'),
  removed: vizVar('removed'),
}

/** Highlight role → semantic token key (role colors, PLAN.md §3.1). */
export const roleTokens: Readonly<Record<Highlight['role'], VizTokenKey>> = {
  active: 'active',
  hit: 'hit',
  miss: 'miss',
  removed: 'removed',
  new: 'new',
}

/** Highlight role → CSS variable reference (convenience for stroke/fill). */
export function roleVar(role: Highlight['role']): string {
  return vizVar(roleTokens[role])
}
