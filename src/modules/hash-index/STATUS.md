# hash-index — module status

Wave 4 module: a Bitcask-style engine — one append-only data file plus an
in-memory hash index (key → byte offset). Third module overall and a second
outsider test of the frozen contract v1 (the append-log validated it in Wave 2B).

| Area      | State                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| state     | `{ seq, file: {id,key,value,seq,offset,tombstone?}[], index: Record<key,offset>, config: { dedupeOnCompact } }`; `staleIds()`, `droppedIds()`, `indexInvariant()`, `entryBytes()` derived               |
| engine    | `write` (hash.write-append → hash.index-set), `read` (hash.index-lookup → hash.read-hit / hash.read-miss), `compact` (hash.compact-scan → hash.compact-drop → hash.compact-rebuild)                     |
| meta      | 3 ops, all `mode: "both"`; 1 boolean setting `dedupeOnCompact`; topics hash-index / bitcask / in-memory index; category Storage Engines, order 3                                                        |
| scenarios | `hash-write-then-read` (hit + miss with zero seeks), `hash-update-compact` (stale versions, compaction, re-read)                                                                                        |
| render    | `Box` index + `Box` file, `KeyCell` per record (`file:<id>` layoutIds), index rows `idx:<key>` with `Arrow` per key (`index:<key>-link`); stale entries dimmed + struck through; reduced motion honored |
| intro     | `Intro.tsx` primer: O(1) point reads vs index-in-RAM + O(n) restart rebuild; use when keys are few and rates high, not for huge key counts or range scans                                               |
| tests     | `runConformance` green; kind-sequence tests per op (incl. tombstone GC, dedupe-off, offsets); fast-check property vs a reference `Map` under both settings                                              |

## Known gaps

- `compact` declares no `inputSchema`; the contract allows an absent schema for
  no-input sandbox ops (PLAN.md §3.5 check 6, same as sstable's compact).
- Tombstoned records can only appear via hand-built/seed states — there is no
  `delete` operation in this module by design (the delete lesson belongs to
  sstable); the type and the GC rule in compaction are ready for one.
- The `dedupeOnCompact` setting reaches the engine through `init(config)`; the
  player store's handling of settings-driven re-init is a shell concern.
- In guided mode, `Write` maps to `hash-write-then-read` (first-op rule) and
  `Read`/`Compact` map to `hash-update-compact` (containing-op rule).

## Contract friction log

See the lane report: no core changes were needed; the only awkwardness is that
the index must be a `Record<string, number>` (no `Map`, JSON-serializable) and
index rows therefore need derived entity ids (`idx:<key>`) that the engine and
render must agree on by convention.
