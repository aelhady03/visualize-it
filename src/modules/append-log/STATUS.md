# append-log — module status

Wave 2B contract-validation module: the simplest storage engine (one append-only
file, backward scan on read, single-pass compaction). Built by a different model from
the Phase 1 owner to test whether the frozen contract v1 reads clearly to an outsider.

| Area      | State                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| state     | `{ seq, entries: {id,key,value,seq}[], config: { dedupeOnCompact } }`; `staleIds()` derived                                                 |
| engine    | `write` (wal.append → log.index), `read` (read.probe×n → read.hit / read.miss), `compact` (compact.merge → compact.done)                    |
| meta      | 3 ops, all `mode: "both"`; 1 boolean setting `dedupeOnCompact`                                                                              |
| scenarios | `write-then-read` (hit + miss), `write-update-compact` (stale versions, compaction, re-read)                                                |
| render    | `Box` file + `KeyCell` per entry (`log:<id>` layoutIds), `Arrow` at the tail; stale entries dimmed + struck through; reduced motion honored |
| intro     | `Intro.tsx` primer (append-only log → compaction → hash index / Bitcask → SSTables)                                                         |
| tests     | `runConformance` green; kind-sequence tests per op; fast-check property vs a reference `Map` under both settings                            |

## Known gaps

- `compact` has a `dryRun` input only because sandbox ops must declare a non-empty
  `inputSchema` (conformance check 6). See the friction log in the Wave 2B report.
- The `dedupeOnCompact` setting is display-only until the player store passes config
  to `engine.init` (shell limitation, not a module one).
- In guided mode, only `Write` has a scenario mapping (both scenarios start with a
  write); `Read` and `Compact` buttons are disabled there.
- The `Intro` component is exported but the module home page still shows a placeholder.
