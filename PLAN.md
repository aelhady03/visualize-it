# Visualize It — Project Plan (v3)

Interactive web app for learning storage engines and their internals through
step-by-step animated visualizations. First module: **SSTable / LSM-Tree**.
Designed from day one to host many modules — one folder per algorithm/storage
engine, added as the author learns each concept.

> **v3 note:** incorporates a critical review and a re-verification by a
> Claude Code worker (2026-11-18). The re-verification verdict was
> **GO-with-minor-edits**; its remaining findings (R1–R6) and contract edits
> (P1–P7) are folded in here. Nice-to-haves live in §10 (Backlog). Read §9
> before assigning models.

> **Multi-model workflow:** different AI models may implement different
> modules in parallel. Each module is isolated under `src/modules/<id>/`.
> `src/core/` and `src/shell/` are owned by whoever implements Phase 1.
> See §9 "Module handoff protocol".

---

## 1. Goals

- Explain **write, read, update, delete, compaction, and crash recovery** in
  an SSTable-based storage engine (LSM-Tree style).
- Pressing an operation (e.g. "Write") plays an animated, step-by-step
  simulation of what happens internally, with narration per step.
- Two modes per operation:
  - **Guided** — pre-scripted, narrated scenario for first exposure.
  - **Sandbox** — user types their own keys/values and watches the real
    consequence. Both modes run the *same* simulation engine.
- Teach the *trade-offs* with live counters: write amplification, read
  amplification, space amplification.
- Extensible: adding a future engine (B-Tree, hash index, append-only log,
  ...) is one folder, auto-discovered — no shared files to edit.

## 2. Tech stack

- Vite + React + TypeScript
- Tailwind CSS
- SVG + Framer Motion for diagrams/animations (no canvas)
- Zustand for player state
- React Router for module routes
- Vitest for simulation-engine unit tests
- ESLint with `eslint-plugin-boundaries` for module isolation (§3.6)
- CI (GitHub Actions): pnpm, typecheck + lint + test on every change
- Browser baseline: last 2 major versions of evergreen browsers
- Deploy target: static hosting (Netlify/Vercel/GH Pages) in Phase 7
- No backend — everything is simulated client-side

### 2.1 Version policy — always latest, never pinned

- **Package manager: pnpm** (latest, via Corepack). All installs and CI use
  pnpm — no npm/yarn commands anywhere.
- **Never pin versions.** No hand-written version numbers in `package.json`
  and no version table in this plan (it would go stale immediately).
  Whenever an agent installs a package it runs `pnpm add <pkg>@latest`
  (scaffold: `pnpm create vite@latest`) and lets npm resolve whatever is
  newest at that moment. The lockfile records what resolved — that is its
  only job; it is regenerated whenever a dependency is added or upgraded.
- **Stay on the repo's resolved majors.** Once scaffolded, all modules build
  against the versions in the lockfile — no ad-hoc upgrades inside a
  module's folder. Dependency upgrades are a single deliberate change:
  `pnpm update --latest` at the repo root, tests + CI green, coordinated by
  the Phase 1 owner.
- **Node.js**: use the latest LTS.
- If a module scaffold happens much later than the project scaffold, agents
  re-resolve `@latest` for *new* tooling only; existing majors stay unless
  the repo-wide upgrade has happened.

**Recorded exceptions (Wave 0, 2026-11-18):**

- **typescript ~6.0.3** (not 7.x): typescript-eslint requires <6.1.0.
  Upgrade only when typescript-eslint supports TS 7 — do not "fix" to
  `@latest` before then.
- **`motion` (14.14.0) instead of `framer-motion`**: `motion` is the current
  home of Framer Motion. Import as `import { motion } from "motion/react"`.
- `eslint-import-resolver-typescript` is present so the boundaries plugin
  resolves the `@core/*` / `@shell/*` aliases — required, don't remove.
- `engines.node: >=26` (latest LTS at scaffold time).

## 3. Architecture

### 3.1 Frozen contract v1

The contract is split into two files so the engine boundary rule stays clean:

- **`@core/engine-contract`** — no React imports: `OpInput`, `Step`, `RunResult`,
  `FieldSpec`, `SettingSpec`, `Scenario`, `Config`, `Highlight`, `Metrics`.
  `engine.ts` imports only this.
- **`@core/view-contract`** — `RenderProps`, `VizModule`, `InputForm`, `Intro`
  (React types live here only).

The shell depends only on these files — never on a specific module. **The
contract tagged `v1-rc` at the end of Phase 1 and is FROZEN as v1 as of
2026-11-18** (git tag `contract-v1`) — the append-log module validated it
from an outsider's perspective and the SSTable state shape is locked (§7).
From now on changes require the Phase 1 owner (§9). `S` is
the module's engine state; it must be JSON-serializable (enforced by the
conformance suite, §3.5).

```ts
// --- @core/engine-contract (no React) ---

type OpInput = Record<string, string | number | boolean>;
type Config = Record<string, string | number | boolean>;

interface Highlight {
  id: string;                 // stable entity id in the state snapshot
  role: "active" | "hit" | "miss" | "removed" | "new" | "stale";
  // "stale" = a superseded version of an entity (old value of an updated key)
}

interface Metrics { [name: string]: number | string }

interface Step<S> {
  kind: string;               // stable tag: "wal.append", "flush.build-index", ...
  state: S;                   // full snapshot of engine state at this step
  narration: string;          // 1–2 sentences: what happened and WHY
  why?: string;               // "why this matters" callout
  highlights?: Highlight[];
  metrics?: Metrics;          // e.g. filesProbed, bytesWritten
  extras?: Record<string, unknown>;  // escape hatch for experiments
}

interface RunResult<S> {
  steps: Step<S>[];           // may be [] if the op no-ops with an error
  result: S;                  // committed state; when steps exist,
                              // invariant: result DEEP-EQUALS steps.at(-1).state
                              // (deep equality, not reference equality — the
                              // conformance suite round-trips through JSON)
  error?: string;             // INVALID INPUT ONLY (empty key, unknown op id).
                              // A read that finds nothing is a normal,
                              // step-emitting operation — not an error.
}

interface FieldSpec {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  required?: boolean;
  options?: string[];         // for select
  default?: string | number | boolean;
  hint?: string;
}

interface Operation {
  id: string;                 // "write" | "read" | "update" | "delete" | "compact" | "crash"
  label: string;
  description: string;
  mode: "guided" | "sandbox" | "both";
  inputSchema?: FieldSpec[];  // REQUIRED when mode includes "sandbox"
}

interface SettingSpec {
  id: string;
  label: string;
  type: "select" | "boolean" | "number";
  options?: string[];
  default: string | number | boolean;
  hint?: string;
}

interface ScenarioOp {
  opId: string;
  input?: OpInput;
}

interface Scenario<S> {
  id: string;
  title: string;
  description: string;
  seedState?: S;              // optional pre-built starting state
  ops: ScenarioOp[];          // chained operations (write → update → read)
}

// Guided-mode mapping rule (implemented by the shell): an operation button
// is enabled in guided mode when a scenario exists whose FIRST op is that
// operation (fallback: a scenario whose id equals the op id). Selecting the
// button starts that scenario.

// --- @core/view-contract (React types) ---

interface RenderProps<S> {
  state: S;
  prevState?: S;              // previous snapshot, for diff-based animation
  direction: 1 | -1;          // forward / backward
  speed: number;              // 0.25–2 from the player
  reducedMotion: boolean;
  highlights: Highlight[];
  onAnimationComplete: () => void;  // call when entry animations settle;
                                    // MUST be called even when nothing animates
}

interface VizModule<S, I extends OpInput = OpInput> {
  contractVersion: 1;
  meta: {
    id: string;               // "sstable"
    title: string;
    description: string;
    topics: string[];
    difficulty: "beginner" | "intermediate" | "advanced";
    category: string;         // sidebar grouping, e.g. "Storage Engines"
    order: number;            // sort key within category
  };
  operations: Operation[];
  settings: SettingSpec[];    // e.g. compaction strategy toggle
  scenarios: Scenario<S>[];
  engine: {
    init(config?: Config): S;
    // NOTE: config is passed to init only — S carries resolved config
    // (S.config). run does NOT take config. Changing a setting resets the
    // module to init(newConfig); switching strategy mid-state is undefined.
    run(opId: string, input: I | undefined, prev: S): RunResult<S>;
  };
  Render: React.FC<RenderProps<S>>;
  InputForm?: React.FC<{ fields: FieldSpec[]; values: OpInput; onChange: (v: OpInput) => void }>;
  Intro?: React.FC;           // module home primer
}
```

**Determinism:** `init` and `run` are pure and deterministic. Any randomness
uses a seeded PRNG; any clock is a logical counter (never `Date.now()`).
The conformance suite enforces this (§3.5).

**Animation convention (part of the contract):**
- Every entity in a state snapshot has a **stable `id`** (an entry, an
  SSTable, a WAL segment, a block, a job). Framer Motion `layoutId`s are
  **namespaced**: `layoutId = `${containerId}:${entityId}`` (e.g.
  `memtable-1:e17`, `sstable-3:e17`). Only the *moving* copy of an entity
  shares a `layoutId` across snapshots — an entry sitting in both a WAL
  segment and a MemTable must not produce two elements with one `layoutId`.
- `Render` receives `prevState`, `direction`, `speed`, `reducedMotion`.
  Core exports a `useStepTransition()` hook implementing shared
  speed/reduced-motion behavior. **Fallback:** the hook auto-calls
  `onAnimationComplete()` when there is nothing to animate (identical states,
  reduced motion), and the player additionally times out after ~2s ÷ speed —
  autoplay must never hang on a missing callback.
- The player advances only after `onAnimationComplete()` fires (plus reading
  time in autoplay, §3.3). Stepping back plays a short reverse crossfade.

### 3.2 Module discovery (no hand-edited registry)

Two globs, no registry file:

- `import.meta.glob('/src/modules/*/meta.ts', { eager: true })` — every
  module exports its `meta` (plus `operations`, `settings`) from a tiny
  `meta.ts`, so the sidebar builds instantly without loading engines.
- `import.meta.glob('/src/modules/*/index.ts')` — lazy-loaded per route;
  `index.ts` exports the full `VizModule`.

Ordering: `meta.category` + `meta.order`. Adding a module is purely additive
— which is what makes §9's "modules never touch core" rule actually work.

### 3.3 Player (shared, written once)

- **One unified timeline per run.** A run = one sandbox operation *or* one
  guided scenario (multiple chained ops). Steps from all ops concatenate;
  operation boundaries become **chapter markers** on the scrub bar.
- Chapters are derived from `step.kind` prefixes; a "fast-forward to next
  chapter" button skips long stretches (a compaction merge can exceed the
  5–10 step budget — that's fine when grouped into chapters).
- Stepper: play/pause, step forward/back, scrub bar, speed 0.25x–2x,
  keyboard shortcuts (←/→ step, Space play/pause, Home/End).
- **Autoplay pacing:** advances after animation-complete plus a reading time
  proportional to narration length; pauses at key step kinds (flush, tombstone
  hit, bloom false positive, compaction drop). Guided mode defaults to
  manual stepping.
- **Diff highlighting:** the shell diffs consecutive snapshots by entity id
  and auto-highlights added/removed/moved elements using the role colors.
- **Sandbox semantics:** running a new operation commits its result
  immediately; playback is a *view* over history. Undo/reset buttons and
  seed-state pickers are **Phase 1 player features** (the seeds themselves are
  module-defined). Bulk inserts are a *module operation* (`write-bulk`),
  not a shell feature.
- Zustand store keyed by module id (each module's sandbox state survives
  switching modules).
- Narration panel shows `narration`; "why this matters" renders `why` as an
  expandable callout adjacent to the diagram.

### 3.4 Theme tokens + shared SVG primitives (`src/core/`)

Semantic design tokens (light + dark) exported by core, used by every module:
`--viz-wal`, `--viz-memtable`, `--viz-file`, `--viz-tombstone`, `--viz-hit`,
`--viz-miss`, `--viz-active`, `--viz-new`, `--viz-removed`.

Tombstones differ by **shape/pattern AND color** (colorblind users).

Core ships shared SVG primitives: `Box`, `KeyCell`, `Arrow`, `BitArray`,
`FileShape`. Module authors compose these; they do not invent their own
palette.

### 3.5 Conformance suite (`src/core/runConformance.ts`)

Every module's test file calls `runConformance(module)`, which checks:
1. determinism — same input twice gives deep-equal steps;
2. JSON round-trip of every state snapshot (normalize explicit `undefined`
   away before comparing — modules must not rely on `undefined` surviving);
3. every step has non-empty `narration` and `kind`;
4. `result` deep-equals `steps.at(-1).state` whenever steps exist;
5. every scenario runs without error from `init()` (or its seed state);
6. every operation with sandbox mode declares `inputSchema` — an empty or
   absent schema is ALLOWED when the operation needs no input (the shell
   renders a bare run button);
7. `Render` mounts for every step of every scenario (jsdom smoke test).

This makes §9's acceptance bar checkable by a module author working alone.

### 3.6 Module isolation with tooling

`eslint-plugin-boundaries`: modules may import only `@core/*`; they may not
import `@shell` or another module; `engine/**`, `lib/**` and `state.ts` may
not import React (they can import only `@core/engine-contract`). CI runs
typecheck + lint + test.
Isolation is enforced by tooling, not prose.

## 4. App shell

- **Sidebar**: modules grouped by `meta.category`, ordered by `meta.order`.
- **Top bar**: operation buttons for the active module (declared operations
  only) + settings controls (from `settings`) + mode toggle (guided/sandbox).
- **Center**: live architecture diagram (module's `Render`).
- **Bottom**: stepper player with chapter markers.
- **Side**: narration panel + expandable "why this matters" + live metrics
  panel (module `metrics`).
- Sandbox input form generated from `inputSchema` (or module `InputForm`).
- Responsive: below ~1280px the panels collapse; the diagram area scrolls or
  zooms as levels grow; old files can be summarized.
- Accessibility: `prefers-reduced-motion` honored (highlights only, no
  translation), keyboard-operable player, focus management.

## 5. SSTable module spec (`src/modules/sstable/`)

### 5.1 Engine state model (JSON-serializable, leveled-ready from Phase 2)

```ts
interface Entry {
  id: string;          // stable entity id, e.g. "e17"
  key: string;         // string keys, lexicographic order (documented in Intro)
  value: string;
  seq: number;         // monotonic sequence number — the reconciliation authority
  tombstone?: boolean; // deletion marker
}

interface Block { id: string; entries: Entry[] }   // sorted; block size ~2

interface SSTable {
  id: string;          // stable id; age ordering in L0 uses seq, not creation
  seq: number;         // MAX entry seq in this file (see Read §5.2)
  blocks: Block[];     // index/minKey/maxKey are DERIVED from blocks,
                       // never stored separately (no invariant drift)
  bloom: number[];     // bit array, 16 bits, k=2
  bytes: number;       // for amplification metrics
}

interface MemTable {
  id: string;
  state: "active" | "immutable";
  entries: Entry[];    // sorted array (a Map is NOT JSON-serializable)
  walSegment: string;  // id of its WAL segment
}

interface WalSegment { id: string; entries: Entry[] }

interface Job {
  id: string;
  kind: "flush" | "compaction";
  inputs: string[];    // entity ids being consumed (memtable / sstable ids)
  output: Entry[];     // merge stream so far — this is what renders mid-merge
  progress: number;    // units done
  total: number;       // units to completion
}

interface EngineState {
  seq: number;             // logical clock + next sequence number
  wal: WalSegment[];       // one segment per MemTable; truncated after flush
  memtables: MemTable[];   // ≤1 active; others immutable, being flushed
  l0: SSTable[];           // flushed files, OVERLAPPING ranges.
                           //   leveled: L0 ordered by age (oldest first)
                           //   stcs:    all files live here as UNORDERED
                           //            sorted runs; buckets are computed at
                           //            compaction time; levels stays []
  levels: SSTable[][];     // leveled only; L1+ (index 0 = L1): disjoint key
                           // ranges per level, target sizes grow ~fanout per level
  jobs: Job[];             // background work: flushes and compactions in flight
  config: Config;          // resolved settings, defaults:
                           //   memtableCap: 6, blockSize: 2, bloomBits: 16,
                           //   bloomHashes: 2, strategy: "stcs" | "leveled",
                           //   l0Trigger: 4, stcsMinThreshold: 4,
                           //   fanout: 3 (demo; narrate that real engines use ~10),
                           //   targetFileSize: number
  metrics: {
    ingestedBytes: number; // cumulative bytes written by users
    bytesWritten: number;  // cumulative bytes flushed + compaction outputs
                           //   (write amplification = bytesWritten / ingestedBytes)
    diskBytes: number;     // current bytes on disk
                           //   (space amplification = diskBytes / liveBytes,
                           //    liveBytes is DERIVED, never stored)
    lastReadFiles: number; // files probed by the last read
    lastReadBlocks: number;
  };
}
```

**Background jobs model (decided):** jobs advance **1 unit per subsequent user
operation**. A flush needs 2 units (so an immutable MemTable is observable for
exactly one operation after the freezing write); a compaction needs
`inputs.length` units. Narration shows "while you ran X, the flush/compaction
made progress". This makes the immutable-MemTable read, mid-merge snapshots,
and write stalls all real and deterministic.

### 5.2 Operation step sequences

**Write** (`write`, key, value) — *writes never block on disk I/O*:
1. `wal.append` — append record to the active WAL segment. Narration:
   durability before anything else; the WAL is what makes an in-memory write
   durable.
2. `memtable.insert` — sorted insert into the **active** MemTable, entry gets
   the next `seq`.
3. `memtable.freeze` — cap reached → the MemTable becomes **immutable**; a new
   active MemTable **and a new WAL segment are created immediately**. A flush
   job (2 units) starts; new writes keep flowing.
4. `jobs.advance` — background jobs make progress (flush → blocks, compaction
   → merge stream), including jobs left over from earlier operations.
5. `flush.complete` — when the flush job finishes: split sorted entries into
   blocks (~2 entries each), derive sparse index (first key per block) and
   bloom filter (16 bits, k=2; show hash → bit positions), the new SSTable
   lands (L0), the immutable MemTable is dropped, **its WAL segment is
   truncated** (that is why the WAL stays bounded).
6. `compact.trigger` (optional) — if thresholds met (§5.2 Compact) and no
   compaction job is running, one starts. If L0 count ≥ `l0Trigger` and a
   compaction job can't keep up, new flushes are shown **stalled** —
   narration: this is a write stall, how compaction debt slows down writes.

**Read** (`read`, key) — probes newest data first:
1. `read.memtable-active` — probe the active MemTable (hit → done).
2. `read.memtable-immutable` — probe immutable MemTables, newest first
   (a read right after a freezing write really can see this state, per the
   jobs model).
3. `read.leveled-l0` / `read.stcs` — strategy-dependent:
   - **leveled**: walk L0 newest → oldest (L0 files may overlap); key-range
     check (`key ∈ [min,max]`), then bloom filter, then sparse index binary
     search, then block scan.
   - **stcs**: all files live in `l0` as *unordered* sorted runs. Probe
     candidate files in **descending `SSTable.seq` (max seq)**. Range check →
     bloom → index → block scan, same as leveled.
4. `read.leveled-levels` — leveled only: binary search over each level's file
   ranges → **at most one file per level** (that bound *is* the
   read-amplification win).
5. **Reconciliation (the R1 fix):** a hit is NOT automatically final.
   - On a hit with entry seq `s`, keep probing while the next candidate
     file's `SSTable.seq` (max seq) is still > `s`; return the hit with the
     **highest seq** overall.
   - **value hit** → return it; **tombstone hit** → return "not found" and
     STOP (a tombstone shadows everything older — include this branch
     explicitly);
   - **bloom says "definitely not"** → skip the file;
   - **bloom false positive** ("maybe", but index/block scan finds nothing) →
     continue to the next file. One guided scenario hits this on purpose.
6. `read.done` — report files/blocks probed → read amplification counter.

**Update** (`update`, key, value):
- Mechanically the write path — the narration is the lesson:
  - It is a **blind write**: no read-before-write, which is a key LSM
    advantage over B-trees.
  - SSTables are **immutable**: the old value stays in its file until
    compaction. "Latest wins" is enforced by comparing `seq` values at read
    time, not by overwriting.
  - If the key is still in the *active MemTable*, the entry is replaced
    in memory — the old version never reaches disk at all.
- Sandbox: after update + read, both versions are visible in different
  files, each with its `seq`.

**Delete** (`delete`, key):
1. Tombstone written through the normal write path (WAL → MemTable → flush).
2. Read path: a tombstone hit ends the search with "not found" even though
   older values still exist in older files.
3. **Tombstone GC rule (the classic gotcha):** a compaction may drop a
   tombstone **only if no older data for that key can exist outside the
   compaction's inputs**:
   - leveled: the output level is the bottommost, or no lower level has a
     file whose range covers the key;
   - stcs: no **older** file (lower max seq) outside the merge can still
     hold the key. A *newer* file holding the key does not block the drop.
   Otherwise the tombstone MUST survive, or the deleted value resurrects.
   (Real-world extra: Cassandra additionally waits `gc_grace_seconds` —
   mention in narration.)
4. Scenario pair (Phase 6): **tombstone kept** by a partial compaction vs
   **tombstone dropped** by a bottommost/full one. That contrast is the lesson.

**Compact** (`compact`) — strategy behind a `settings` toggle, **both
implemented**:

- **Size-tiered (STCS):** files grouped into buckets of similar size; a bucket
  with ≥ `stcsMinThreshold` (4) files merges into one. Animated merge-sort
  over key ranges; stale versions and *eligible* tombstones drop out of the
  merge stream. Transient disk need up to ~2x during a big merge.
- **Leveled:** L0 files have overlapping ranges (ordered by age); L1+ are
  single sorted runs split into files with **disjoint ranges**, target sizes
  grow ~`fanout` per level (demo 3, real ~10). A compaction picks one file
  from Ln (by score or round-robin) and merges it with **all Ln+1 files whose
  ranges overlap it**; output is split at `targetFileSize`. L0→L1 takes all
  overlapping L0 files.
- **Triggers (decided):** auto-trigger at write step 6 when thresholds are
  met (L0 count ≥ `l0Trigger`, or a level exceeding its target size) and no
  compaction job is running. The explicit `compact` button runs the same
  path manually.
- **Write stalls:** when L0 count ≥ `l0Trigger` and a compaction job is still
  in flight, new flushes are shown stalled — compaction debt slowing down
  writes, narrated.
- **Amplification as live counters** (computed from `metrics`, not just
  narrated):
  - write amplification = `bytesWritten` / `ingestedBytes`;
  - read amplification = files/blocks probed by the last read;
  - space amplification = `diskBytes` / derived live bytes.
  Show STCS's ~2x transient space vs leveled's ~1.1x.

**Crash & recover** (`crash`):
1. Simulate a crash: wipe all MemTables (memory is gone); jobs are lost.
2. Replay the **unflushed** WAL segments — **per segment** (there may be an
   active and an immutable one): rebuild MemTable(s) from them. Restore the
   `seq` counter to the max seq found in the WAL and SSTables — it was
   in-memory state too, and the narration should say so. **A replayed
   immutable MemTable gets a fresh flush job re-queued** (jobs themselves
   are lost in the crash) — otherwise its data would never reach disk.
3. Narration: this is what the WAL is *for*; flushed segments were already
   truncated, which is why recovery is cheap.

**Bulk write** (`write-bulk`, count, seed):
- Sandbox helper operation: insert N random keys (seeded PRNG) through the
  normal write path, with a skip-animation option. Lets learners reach
  flush/compaction states without typing 30 writes.

### 5.3 Guided scenarios (`scenarios.ts`)

Named multi-op scripts feeding the same `engine.run`:
- `write-then-read` — write several keys, read one back.
- `update-latest-wins` — write, **force a flush**, update, read: both versions
  visible in different files, `seq` numbers shown.
- `delete-tombstone-kept` (Phase 6) — delete, partial compaction: tombstone
  survives.
- `delete-tombstone-dropped` (Phase 6) — delete, bottommost/full compaction:
  GC'd.
- `bloom-false-positive` — a key that filters "maybe" but isn't there.
- `compaction-stcs` — enough writes to fill a bucket + merge.
- `compaction-leveled` — L0 spill into L1 with overlapping-range merge.
- `crash-replay` — writes, crash, WAL replay.
- Seed states (sandbox starters): "6 SSTables across 3 levels", "bucket of 4
  similar-size files", "files with a stale version + a tombstone".

## 6. File structure

```
src/
  core/            # engine-contract, view-contract, discovery (two globs),
                   # player store, theme tokens, SVG primitives,
                   # useStepTransition, runConformance — OWNED by Phase 1
  shell/           # sidebar, operation bar, stepper player, narration, metrics panel
  modules/
    sstable/
      meta.ts         # meta + operations + settings (eager, for the sidebar)
      index.ts        # exports the full VizModule (lazy-loaded)
      state.ts        # EngineState types + defaultConfig (owned by module lead)
      defaults.ts
      lib/            # derive.ts, bloom.ts, merge.ts — "use, don't rewrite"
      engine/         # index.ts dispatcher + write, read, update, compact,
                      # compact-stcs, compact-leveled, crash, bulk
                      # (pure simulation; engine/** imports only @core/engine-contract)
      render/         # index.tsx + WalView, MemTableView, LevelsView,
                      # SSTableView, BloomView, JobsView
      scenarios/      # index.ts + per-op script files + seed states
      fixtures/       # JSON state snapshots (typed via `satisfies EngineState`)
      engine.test.ts  # Vitest + runConformance + property tests (per-op test files)
      Intro.tsx       # primer page
      STATUS.md       # per-module progress (see §9)
  pages/           # routes: /, /modules/:id, /modules/:id/view
```

## 7. Build order

| Phase | Deliverable | Notes |
|-------|-------------|-------|
| 1 | **Contract v1-rc + shell skeleton.** Both contract files (§3.1, incl. the P1–P7 resolutions: config via `init` only, animation fallback, invalid-input-only errors, deep-equal invariant, namespaced `layoutId`s, two-glob discovery, split engine/view contract), unified-timeline player with chapters + undo/reset + seed-state picker, theme tokens + SVG primitives, `useStepTransition`, `runConformance`, ESLint boundaries + CI, **animation spike** (placeholder module proves the Render/Framer Motion/player-speed pipeline). | Exit criteria: contract tagged **v1-rc**, conformance suite green on a real tiny module, animation pipeline proven. Owns `src/core` + `src/shell`. |
| 2 | SSTable engine core (pure TS): state with `l0` + `levels` + `seq` + `jobs` (§5.1), write/flush path incl. immutable MemTable + WAL segments/truncation. **Locks the state shape:** jobs model, config types/defaults, `bytesWritten` metrics. Property test: after any random op sequence, every read matches a reference `Map` — **run under BOTH strategies**. **In parallel:** a second trivial module (append-only log) to validate the contract while it's cheap to change. | No UI yet. **Exit (G2+G3): state shape locked, append-log green, contract tagged v1 (frozen).** |
| 3 | Write visualization end-to-end (guided + sandbox) + **crash & recover** + `write-bulk` operation. | First full loop through contract + player. |
| 4 | Read path: range checks, bloom filter incl. **false-positive branch**, sparse index, tombstone termination, immutable MemTable in reads, **max-seq reconciliation (R1)** for STCS, read-amplification counter. | |
| 5 | Update & Delete: `seq` latest-wins, tombstones. | Tombstone GC *scenarios* live in Phase 6; Phase 5 implements the rule in the engine + tests. |
| 6 | Compaction: STCS, then leveled — triggers, jobs-driven merge animation, amplification counters, write stalls, tombstone kept-vs-dropped scenarios. | The star feature. |
| 7 | Polish: accessibility details, keyboard shortcuts, deploy to static hosting. Optional: range scans (merging iterator) as a bonus operation. | |

## 8. Conventions (applies to every module)

- **Engine purity**: `engine/**` and `lib/**` import only `@core/engine-contract`
  — nothing from React, nothing from another module. State snapshots are plain
  JSON-serializable objects (no `Map`, no dates, no classes, no reliance on
  `undefined` surviving). Deterministic: logical clocks (`seq`), seeded PRNG
  for any randomness.
- **Tests**: assert step **`kind` sequences** and state invariants — never
  narration wording (prose edits shouldn't break tests). SSTable invariants:
  sortedness, no duplicate keys within a file, disjoint key ranges in L1+,
  **per-key seq strictly decreases from L0 down through the levels**, WAL ⊇
  unflushed MemTable. Property-based tests (fast-check) where sequences are
  involved; the reference-`Map` property test runs under both compaction
  strategies; every module calls `runConformance` (§3.5).
- **Rendering**: SVG only, Framer Motion, semantic tokens + core primitives
  (§3.4), stable entity ids with namespaced `layoutId`s (§3.1), tombstones
  distinct by shape and color.
- **Narration**: 1–2 sentences per step, plain language, explains *why*, not
  just *what*.
- **Steps**: one conceptual change per step. Long operations (compaction
  merges) may exceed 5–10 steps — group them into chapters (§3.3) instead of
  compressing them.

## 9. Module handoff protocol (multi-model workflow)

- **Modules are islands.** A model working on `src/modules/<id>/` must not
  touch `src/core/`, `src/shell/`, or another module's folder. ESLint
  boundaries enforce this; CI blocks violations.
- **No shared files to edit.** Modules are auto-discovered (§3.2). Per-module
  status lives in `src/modules/<id>/STATUS.md`, not in this file — parallel
  models never edit the same document.
- **Contract changes** go through the Phase 1 owner: bump `contractVersion`
  and update §3.1. Modules may use `Step.extras` to experiment without a core
  change.
- **Acceptance bar per module:** `runConformance` green + engine tests green +
  guided and sandbox both work in the player.
- **Handoff brief** should include: §3 (contract) + §8 (conventions) + the
  module's spec section + the module's `STATUS.md`. This file is the only
  shared reference needed.

Current status (see each module's `STATUS.md` for detail):

| Module | Status |
|--------|--------|
| sstable | foundation merged (state, libs, write/flush/jobs engine); Wave 3 pending: read, update/delete, crash/bulk, STCS + leveled compaction, render + scenarios |
| append-log | DONE — full module merged; validated contract v1 |
| hash-index | not started |

## 10. Backlog (nice-to-haves from review)

- Cross-module state URLs: deep-link `?op=&scenario=&step=` for sharing steps.
- ADR log for contract changes (beyond the `contractVersion` bump).
- Predict-then-reveal prompts ("which file will the read check next?").
- Hover-linking narration terms to diagram elements; persistent mini-legend.
- Persist user speed preference; reduced-motion mode details.
- Intro notes: MemTables are usually skiplists/balanced trees (even though
  drawn as sorted lists); blocks + index/filter blocks are what actually get
  read from disk — that's what the index and bloom filter save.
- Optional split of this file into `docs/contract.md` + per-module spec files
  once module count grows.
