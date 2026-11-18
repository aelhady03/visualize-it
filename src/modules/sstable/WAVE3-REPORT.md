# Wave 3 sstable skeleton — lead report for the 5 lanes

Commit `3dbe072` on `w3/sstable-lead`. The skeleton is green on all gates; each
lane replaces exactly its stub files below and must keep the exact signatures.
Anything else in the module is lead-owned — **do not edit**; escalate instead.

## 1. Exact export signatures lanes must match

### Engine runners (`engine/<op>.ts`, one file per lane, wired by the registry)

```ts
export function runRead(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
export function runUpdate(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
export function runDelete(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
export function runCompact(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
export function runCrash(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
export function runBulk(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
```

- Argument order is **(state, input)**. The registry in `engine/index.ts` is
  `{ write, read: runRead, update: runUpdate, delete: runDelete, compact: runCompact,
  crash: runCrash, "write-bulk": runBulk }` (`write` is an adapter over the
  existing `engine/write.ts`); lanes add no entries, they fill the stubs.
- Return `RunResult<EngineState>`: `{ steps: Step<EngineState>[], result: EngineState, error? }`.
  `error` is for INVALID INPUT only; `result` must deep-equal `steps.at(-1).state`
  whenever steps exist. Stubs currently return
  `{ steps: [], result: state, error: "not implemented" }`.
- Pure files: engine/** imports only `@core/engine-contract` and the module's own
  pure files (`state.ts`, `lib/**`, `engine/**`). Deterministic: logical `seq`
  clock, seeded PRNG only (no Math.random, no Date.now).

### Render regions (`render/<Name>.tsx`, one file per lane)

```tsx
export function WalView(props: WalViewProps)          // { wal, seq, highlights, speed, reducedMotion }
export function MemTableView(props: MemTableViewProps) // { memtables, highlights, speed, reducedMotion }
export function LevelsView(props: LevelsViewProps)     // { l0, levels, strategy, highlights, speed, reducedMotion }
export function MergeView(props: MergeViewProps)       // { jobs, l0, levels, highlights, speed, reducedMotion }
export function BloomView(props: BloomViewProps)       // { l0, levels, highlights, speed, reducedMotion }
```

- Prop types are FROZEN in `render/regions.ts` (lead-owned); match them exactly.
- Regions draw in LOCAL coordinates starting at (0, 0) — `render/index.tsx`
  places each region with a `<g transform="translate(...)">`. Stay inside the
  band reserved for you (constants from `regions.ts`): `WAL_ROW_H` 26 ×
  `wal.length`, `MEMTABLE_ROW_H` 46 × `memtables.length`, `LEVELS_BAND` 300,
  `MERGE_BAND` 96, `BLOOM_BAND` 76.
- Namespaced layoutIds (PLAN.md §3.1): `wal:<segmentId>:<entryId>`,
  `memtable:<mtId>:<entryId>`, `sstable:<fileId>:<entryId>`,
  `merge:<jobId>:<entryId>`. Exactly ONE element per layoutId per snapshot.
- **Never call `onAnimationComplete`** — `render/index.tsx` owns completion
  (`useStepTransition` + `completeAfter` for the FLIP moves). `JobRow` is
  lead-owned (full implementation); both compaction lanes reuse it, do not edit.

### Scenario arrays (`scenarios/<op>.ts`, fill the stub, keep the names)

```ts
export const writeScenarios: Scenario<EngineState>[] = []              // read lane: "write-then-read"
export const readScenarios: Scenario<EngineState>[] = []               // read lane: "bloom-false-positive"
export const updateScenarios: Scenario<EngineState>[] = []             // update/delete lane: "update-latest-wins"
export const deleteScenarios: Scenario<EngineState>[] = []             // update/delete lane: "delete-tombstone-kept", "delete-tombstone-dropped"
export const stcsCompactionScenarios: Scenario<EngineState>[] = []     // STCS lane: "compaction-stcs"
export const leveledCompactionScenarios: Scenario<EngineState>[] = []  // leveled lane: "compaction-leveled"
export const crashScenarios: Scenario<EngineState>[] = []              // crash/bulk lane: "crash-replay"
```

`scenarios/index.ts` concatenates all seven arrays; do not edit it. Every
scenario must run without error from `init()`/its `seedState` (conformance
check 5) and deterministically (check 1).

## 2. File → lane map

| Lane | Files it replaces (stubs) | Scenario ids it fills |
| --- | --- | --- |
| **read** | `engine/read.ts`, `render/BloomView.tsx`, `scenarios/read.ts`, `scenarios/write.ts` | bloom-false-positive, write-then-read |
| **update/delete** | `engine/update.ts`, `engine/delete.ts`, `scenarios/update.ts`, `scenarios/delete.ts` | update-latest-wins, delete-tombstone-kept, delete-tombstone-dropped |
| **crash/bulk** | `engine/crash.ts`, `engine/bulk.ts`, `render/WalView.tsx`, `render/MemTableView.tsx`, `scenarios/crash.ts` | crash-replay |
| **STCS compaction** | `engine/compact.ts` (stcs half), `render/MergeView.tsx`, `scenarios/compaction.ts` → `stcsCompactionScenarios` | compaction-stcs |
| **leveled compaction** | `engine/compact.ts` (leveled half), `render/LevelsView.tsx`, `scenarios/compaction.ts` → `leveledCompactionScenarios` | compaction-leveled |

Shared seams: `engine/compact.ts` is shared by the two compaction lanes —
dispatch by `state.config.strategy` inside `runCompact` (coordinate ownership
through the coordinator). `scenarios/compaction.ts` exports one array per lane
so neither edits the other's symbol. Every other file in `src/modules/sstable/`
is **lead-owned, do not edit**: `meta.ts`, `index.ts`, `engine/index.ts`,
`engine/write.ts`, `engine/jobs.ts`, `state.ts`, `defaults.ts`, `lib/**`,
`render/index.tsx`, `render/regions.ts`, `render/JobRow.tsx`,
`scenarios/index.ts`, `Intro.tsx`, `engine.test.ts`, `fixtures/**`, `STATUS.md`.

## 3. Verify summary (all gates green on 3dbe072)

- `pnpm install --frozen-lockfile` — OK (pnpm 12.21.0, node 26).
- `pnpm verify` — typecheck + eslint + vitest: **227 tests passed** (19 files),
  including `runConformance(sstableModule)` (empty scenarios + stub ops).
- `pnpm build` — OK; sstable chunk built (12.59 kB).
- `BASE=main scripts/check-scope.sh 'src/modules/sstable/**'` —
  `check-scope: OK — 27 changed file(s), all in scope`.
- Existing write-path tests kept green; only the "not implemented" test was
  updated for the new registry (stubs return `"not implemented"`, unknown op
  ids return `"not implemented yet"`).

## 4. Lanes' notes

- Read lane: probe order + max-seq reconciliation (R1) + tombstone termination
  + bloom false-positive branch; step kinds prefixed `read.` (PLAN.md §5.2).
- Compaction lanes: triggers, jobs-driven merges, write stalls, tombstone GC
  rule, amplification counters; `JobRow` renders every job's progress — focus
  on the merge animation and file motion.
- Crash/bulk: WAL replay per segment, `seq` restore; bulk reuses the normal
  write path with a seeded PRNG (`count`, `seed` inputs from meta.ts).
- Tests: assert step `kind` sequences + invariants, never narration wording;
  every module change must keep `runConformance` and the existing suite green.
