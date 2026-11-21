/**
 * hash-index meta — the eager half of module discovery (PLAN.md §3.2).
 */

import type { Operation, SettingSpec } from '@core/engine-contract'
import type { VizModule } from '@core/view-contract'

export const meta = {
  id: 'hash-index',
  title: 'Hash Index',
  description:
    'Bitcask-style: an append-only file plus an in-memory hash index. Writes append, reads are one lookup plus one seek, and compaction reclaims stale bytes.',
  topics: ['hash-index', 'bitcask', 'in-memory index'],
  difficulty: 'beginner',
  category: 'Storage Engines',
  order: 3,
} as const satisfies VizModule<unknown>['meta']

export const operations: Operation[] = [
  {
    id: 'write',
    label: 'Write',
    description:
      'Append a key=value record to the file and point the in-memory index at its offset.',
    mode: 'both',
    inputSchema: [
      { id: 'key', label: 'Key', type: 'text', required: true, default: 'apple' },
      { id: 'value', label: 'Value', type: 'text', required: true, default: 'red' },
    ],
  },
  {
    id: 'read',
    label: 'Read',
    description: 'One hash lookup in the in-memory index, then one seek to the offset it names.',
    mode: 'both',
    inputSchema: [{ id: 'key', label: 'Key', type: 'text', required: true, default: 'apple' }],
  },
  {
    id: 'compact',
    label: 'Compact',
    description:
      'Rewrite the file keeping only the newest entry per key, then rebuild the index at the new offsets.',
    mode: 'both',
    // No-input op: an ABSENT inputSchema is allowed by the contract (§3.5,
    // check 6) — the shell renders a bare run button.
  },
]

export const settings: SettingSpec[] = [
  {
    id: 'dedupeOnCompact',
    label: 'Dedupe on compact',
    type: 'boolean',
    default: true,
    hint: 'When off, compaction copies every entry and reclaims nothing.',
  },
]
