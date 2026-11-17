/**
 * append-log meta — the eager half of module discovery (PLAN.md §3.2).
 */

import type { Operation, SettingSpec } from '@core/engine-contract'
import type { VizModule } from '@core/view-contract'

export const meta = {
  id: 'append-log',
  title: 'Append-Only Log',
  description:
    'The simplest storage engine: every write is appended to one file, reads scan backward from the tail, and compaction drops stale versions.',
  topics: ['append-only log', 'sequential writes', 'log scan', 'compaction'],
  difficulty: 'beginner',
  category: 'Storage Engines',
  order: 1,
} as const satisfies VizModule<unknown>['meta']

export const operations: Operation[] = [
  {
    id: 'write',
    label: 'Write',
    description: 'Append a key=value entry to the end of the log.',
    mode: 'both',
    inputSchema: [
      { id: 'key', label: 'Key', type: 'text', required: true, default: 'k1' },
      { id: 'value', label: 'Value', type: 'text', required: true, default: 'v1' },
    ],
  },
  {
    id: 'read',
    label: 'Read',
    description: 'Scan backward from the tail until the newest entry for the key is found.',
    mode: 'both',
    inputSchema: [{ id: 'key', label: 'Key', type: 'text', required: true, default: 'k1' }],
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Rewrite the log in one pass, keeping only the newest version of each key.',
    mode: 'both',
    // The contract requires a non-empty inputSchema for sandbox ops, so compact
    // exposes a real (optional) dry-run flag rather than a placeholder field.
    inputSchema: [
      {
        id: 'dryRun',
        label: 'Dry run',
        type: 'boolean',
        default: false,
        hint: 'Show what would be dropped without rewriting the log.',
      },
    ],
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
