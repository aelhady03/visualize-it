# sstable — module status

Wave 3: the **SSTable / LSM-Tree** module (PLAN.md §5). Foundation merged in
Wave 2 (state model, libs, write/flush/jobs engine). Wave 3 ships the full
module in five parallel lanes; this file tracks the lanes, what is merged,
and what each lane owns.

## Wave 3 lanes

| Lane                    | Owns (replace these stubs)                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **lead** (this branch)  | `meta.ts`, `index.ts`, `engine/index.ts` (registry), `render/index.tsx`, `render/regions.ts`, `render/JobRow.tsx`, `scenarios/index.ts`, `Intro.tsx`, `engine.test.ts` skeleton, `STATUS.md` — written once, lanes do NOT edit |
| **read**                | `engine/read.ts`, `render/BloomView.tsx`, `scenarios/read.ts` (bloom-false-positive), `scenarios/write.ts` (write-then-read)   |
| **update/delete**       | `engine/update.ts`, `engine/delete.ts`, `scenarios/update.ts` (update-latest-wins), `scenarios/delete.ts` (delete-tombstone-kept, delete-tombstone-dropped) |
| **crash/bulk**          | `engine/crash.ts`, `engine/bulk.ts`, `render/WalView.tsx`, `render/MemTableView.tsx`, `scenarios/crash.ts` (crash-replay)      |
| **STCS compaction**     | `engine/compact.ts` stcs half, `render/MergeView.tsx`, `scenarios/compaction.ts` → `stcsCompactionScenarios` (compaction-stcs) |
| **leveled compaction**  | `engine/compact.ts` leveled half, `render/LevelsView.tsx`, `scenarios/compaction.ts` → `leveledCompactionScenarios` (compaction-leveled) |

Shared seams the lanes agree on (see the stub comments in each file):

- Engine runners: `runX(state: EngineState, input: OpInput | undefined): RunResult<EngineState>`.
- Render regions: one exported component per stub file, typed against `render/regions.ts`.
- `engine/compact.ts` and `scenarios/compaction.ts` are shared by the two
  compaction lanes — dispatch by `state.config.strategy` inside `runCompact`,
  and one scenario array per lane. Coordinate ownership through the coordinator.

## Merged so far (Wave 2 foundation)

- `state.ts` — full `EngineState` (§5.1): entries, blocks, SSTables, memtables,
  WAL segments, jobs, metrics, config defaults (`memtableCap 6, blockSize 2,
  bloomBits 16, bloomHashes 2, strategy stcs, l0Trigger 4, stcsMinThreshold 4,
  fanout 3, targetFileSize 128`), type guards. `defaults.ts` re-exports.
- `lib/` — derive (sorting, sparse index, bytes, invariants), bloom (16-bit
  k=2 FNV/djb2), merge (`mergeRuns`, `mergePair`), config (`resolveConfig`).
- `engine/write.ts` + `engine/jobs.ts` — the write path: wal.append →
  memtable.insert → memtable.freeze → jobs.advance → flush.complete →
  compact.trigger; flush jobs build SSTables (blocks, bloom, bytes metrics)
  and truncate WAL segments.
- Fixtures (`fixtures/*.json` + `fixtures.test.ts`), `state.test.ts`,
  property tests vs a reference Map under both strategies (green).

## Wave 3 skeleton merged (this branch)

- `meta.ts` — 7 operations (write, read, update, delete, compact, crash,
  write-bulk; compact/crash are no-input ops), 5 settings (strategy,
  memtableCap, fanout, l0Trigger, stcsMinThreshold).
- `engine/index.ts` — registry dispatcher; `write` wired to `engine/write.ts`;
  read/update/delete/compact/crash/bulk route to typed stubs returning
  `{ steps: [], result: state, error: "not implemented" }`.
- `render/` — composition (`index.tsx`, layout + FLIP completion wiring),
  frozen `RegionProps` (`regions.ts`), stub regions (WalView, MemTableView,
  LevelsView, MergeView, BloomView), full `JobRow`.
- `scenarios/` — per-op stub arrays, concatenated in `scenarios/index.ts`.
- `Intro.tsx` — SSTable + LSM-tree primer.
- `engine.test.ts` — existing write/init/jobs/property tests kept green plus
  `runConformance(sstableModule)` (passes with empty scenarios + stub ops).

## Gates

- `BASE=main scripts/check-scope.sh 'src/modules/sstable/**'` → exit 0
- `pnpm verify` and `pnpm build` green on `w3/sstable-lead`.

## Remaining (the lanes)

- Read path (§5.2 Read) incl. max-seq reconciliation and the bloom
  false-positive branch + read-amplification counters.
- Update/delete (§5.2) incl. the tombstone GC kept-vs-dropped contrast.
- Crash & recover (§5.2) + `write-bulk` (seeded PRNG).
- STCS and leveled compaction (§5.2 Compact): triggers, jobs-driven merges,
  write stalls, amplification counters.
- Guided scenarios (§5.3) in the per-op scenario files.
- Region implementations in `render/` per the table above.
