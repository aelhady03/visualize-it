# Visualize It

**Storage engines, step by step.** An interactive lab that visualizes what actually happens *inside* a database storage engine — every write, read, update, delete and compaction plays as an animated, narrated sequence you can step through one event at a time.

Live: <https://aelhady03.github.io/visualize-it/>

## What you can do here

- **Press an operation and watch it happen.** Write a key and follow it: into the write-ahead log, into the in-memory table, into a flushed SSTable on disk, through compaction. Every step is animated in the diagram and explained in the run log — *what* changed and *why*.
- **Guided scenarios** for first exposure, or **sandbox mode** where you type your own keys and watch the engine react to your exact input.
- **Understand the trade-offs, not just the mechanics.** Each engine has a primer: why it exists, what you gain and what it costs, the questions it answers, and when to use it — and when not to.

## Engines

| Module | Teaches |
| --- | --- |
| **SSTable / LSM-Tree** | MemTables, write-ahead logs, immutable sorted files, sparse indexes, bloom filters (with real false positives), tombstones, crash recovery, and compaction — both **size-tiered** and **leveled** — with live write/read/space amplification counters |
| **Append-Only Log** | The simplest durable store: append writes, backward-scans, compaction of stale versions — the foundation every other engine builds on |

Each module is one folder (`src/modules/<id>/`) implementing a frozen contract — adding a new engine means writing that folder, nothing else.

## Tech stack

React 19 + TypeScript, Vite, Tailwind CSS v4, Motion (Framer Motion) for the diagram animations, Zustand for the player state, Vitest for the simulation tests. The engine simulations are pure, deterministic TypeScript — no React, JSON-serializable state snapshots, tested with property tests against a reference map.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev          # local server on :5173
pnpm verify       # typecheck + lint + tests
pnpm build        # production build
```

CI runs `pnpm verify` + `pnpm build` on every push and pull request. The live site deploys from `main` to GitHub Pages automatically.

## How it's structured

- `src/core/` — the frozen module contract, the stepper player (timeline, chapters, autoplay), theme tokens, SVG primitives, and the conformance suite every module must pass.
- `src/shell/` — the lab UI: operation bar, diagram stage, run log with per-step traces, transport controls.
- `src/modules/` — one folder per engine: `meta.ts` + `index.ts` (auto-discovered), a pure `engine/`, an SVG `render/`, `scenarios/`, an `Intro` briefing, and tests.

The full project plan — architecture, the module contract, the SSTable spec, and the build phases — lives in [`PLAN.md`](PLAN.md). Operating rules for contributors (and AI agents) are in [`AGENTS.md`](AGENTS.md).

## Roadmap

- Guided scenarios for update / delete / compaction / crash (`update-latest-wins`, tombstone kept-vs-dropped) so every operation has a narrated tour
- A Hash Index engine
- Narration harmonization pass across the SSTable operations
- Predict-then-reveal prompts, deep-linkable steps
