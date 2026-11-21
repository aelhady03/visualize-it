/**
 * hash-index guided scenarios. The shell maps an operation button to the
 * first scenario whose id equals the op id, else whose first op matches,
 * else any scenario containing it (PLAN.md §3.1).
 */

import type { Scenario } from '@core/engine-contract'
import type { HashIndexState } from '../state'

export const scenarios: Scenario<HashIndexState>[] = [
  {
    id: 'hash-write-then-read',
    title: 'Write, then read',
    description:
      'Append three keys and watch the index grow one arrow at a time; then read one back with a single seek, and miss another with zero disk I/O.',
    ops: [
      { opId: 'write', input: { key: 'apple', value: 'red' } },
      { opId: 'write', input: { key: 'kiwi', value: 'green' } },
      { opId: 'write', input: { key: 'plum', value: 'purple' } },
      { opId: 'read', input: { key: 'kiwi' } },
      { opId: 'read', input: { key: 'mango' } },
    ],
  },
  {
    id: 'hash-update-compact',
    title: 'Update, then compact',
    description:
      'Overwriting a key appends a new version and repoints the index; compaction later drops the stale bytes and rebuilds both the file offsets and the index.',
    ops: [
      { opId: 'write', input: { key: 'apple', value: 'red' } },
      { opId: 'write', input: { key: 'kiwi', value: 'green' } },
      { opId: 'write', input: { key: 'apple', value: 'green' } },
      { opId: 'write', input: { key: 'apple', value: 'gold' } },
      { opId: 'read', input: { key: 'apple' } },
      { opId: 'compact' },
      { opId: 'read', input: { key: 'kiwi' } },
    ],
  },
]
