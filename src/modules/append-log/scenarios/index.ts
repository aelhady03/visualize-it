/**
 * append-log guided scenarios. The shell maps an operation button to the
 * first scenario whose id equals the op id, else whose first op matches.
 */

import type { Scenario } from '@core/engine-contract'
import type { AppendLogState } from '../state'

export const scenarios: Scenario<AppendLogState>[] = [
  {
    id: 'write-then-read',
    title: 'Write, then read',
    description:
      'Append three keys, then read one back: the reader scans backward from the tail until it hits.',
    ops: [
      { opId: 'write', input: { key: 'apple', value: 'red' } },
      { opId: 'write', input: { key: 'kiwi', value: 'green' } },
      { opId: 'write', input: { key: 'plum', value: 'purple' } },
      { opId: 'read', input: { key: 'apple' } },
      { opId: 'read', input: { key: 'mango' } },
    ],
  },
  {
    id: 'write-update-compact',
    title: 'Update, then compact',
    description:
      'Overwriting a key appends a new version instead of editing in place; compaction later drops the stale ones.',
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
