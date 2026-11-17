# AGENTS.md — operating manual for every agent in this repo

`PLAN.md` is the project spec and the single source of truth for _what_ to build.
This file covers _how_ to work in the repo. Read both before you change anything.

## 1. The gate: `pnpm verify`

```sh
pnpm install --frozen-lockfile   # once per worktree
pnpm verify                      # typecheck + lint + test — must be green before you report done
pnpm build                       # production build (CI runs it too)
```

`pnpm typecheck`, `pnpm lint` and `pnpm test` (vitest run) run the stages one at a time.
CI (`.github/workflows/ci.yml`) runs `install --frozen-lockfile`, then `verify`, then `build`, on every PR.

## 2. Stack and package manager

**pnpm only.** Use `pnpm add`, `pnpm exec` and `pnpm dlx` for everything. The pnpm version
is the `packageManager` field in `package.json` (Corepack: `corepack enable`). Node is
the latest LTS (`engines.node`).

Versions resolved at bootstrap (2026-11-18). After that date `pnpm-lock.yaml` is the
truth, so check it rather than this table:

| Area        | Packages                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime     | node 26 LTS "Lithium", pnpm 12.21.0                                                                                                                                                                                                        |
| App         | react 19.3.1, react-dom 19.3.1, react-router-dom 7.18.5, zustand 5.1.0, motion 14.14.0                                                                                                                                                     |
| Build       | vite 8.3.8, @vitejs/plugin-react 6.3.0, typescript 6.0.3 (see §2.1), tailwindcss 4.3.5 + @tailwindcss/vite 4.3.5                                                                                                                           |
| Test        | vitest 5.1.0, jsdom 31.0.1, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, fast-check 4.10.2                                                                                                                                  |
| Lint/format | eslint 10.15.0, @eslint/js 10.0.1, typescript-eslint 8.73.0, eslint-plugin-boundaries 7.4.4, eslint-import-resolver-typescript 4.4.5, eslint-plugin-react-hooks 7.1.1, eslint-plugin-react-refresh 0.5.8, globals 17.14.0, prettier 3.10.1 |
| Types       | @types/react 19.3.0, @types/react-dom 19.3.0, @types/node 26.6.6                                                                                                                                                                           |

**Decisions at bootstrap:**

- **Animation: `motion`, not `framer-motion`.** `motion` is where Framer Motion now lives,
  with the same API (`motion.div`, `AnimatePresence`, `layoutId`, `useReducedMotion`).
  Import from **`motion/react`**. The PLAN's "Framer Motion" means this package.
- **Tailwind v4 is CSS-first.** There is no `tailwind.config.*`. The Vite plugin is in
  `vite.config.ts` and `@import "tailwindcss";` is in `src/index.css`. Theme tokens use
  CSS `@theme` / custom properties.
- **Path aliases**: `@core/*` → `src/core/*` and `@shell/*` → `src/shell/*` are defined
  once in `tsconfig.app.json` `paths`. Vite and Vitest read them via
  `resolve.tsconfigPaths`, and ESLint reads them via the TS import resolver.
- **Tests**: Vitest uses the `jsdom` environment and picks up `src/**/*.test.{ts,tsx}`.

### 2.1 Version policy: always `@latest`, never pinned (PLAN.md §2.1)

- Install new packages with `pnpm add <pkg>@latest`, and never type a version number by hand.
  The lockfile records what resolved.
- Build against the majors in the lockfile. A dependency upgrade happens once, as a
  deliberate repo-wide change (`pnpm update --latest`, verify green), and the
  integrator coordinates it.
- **Known exception:** `typescript` stays on the 6.0 line (`~6.0.3`, as `create-vite`
  set it). `typescript@latest` is 7.x, but typescript-eslint's peer range is
  `<6.1.0`. Move to TS 7 when typescript-eslint supports it.

## 3. Shared-file ownership

These files belong to the **integrator** (the Phase 1 owner / coordinator). For a module's
`STATUS.md`, the owner is that **module's lead**:

- `package.json`, `pnpm-lock.yaml`
- every config: `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc.json`,
  `.prettierignore`, `.gitignore`, `.github/**`, `scripts/**`
- `AGENTS.md`, `CLAUDE.md`, `PLAN.md`
- `src/modules/<id>/STATUS.md` (module lead only)

As a **lane worker**, you **escalate** a needed change to one of these (a new dependency,
a config tweak, a doc fix) to your coordinator, with the exact change and the reason. The
integrator makes the edit. This keeps parallel branches free of merge conflicts in
shared files.

## 4. Lanes and scope

Each worker gets a **lane**: a set of paths it may change, written as globs in its task brief.
Before reporting done, commit and prove you stayed inside the lane:

```sh
scripts/check-scope.sh 'src/modules/sstable/**'            # one glob
scripts/check-scope.sh 'src/core/player/**' 'src/core/player.test.ts'   # several
```

It compares `git diff --name-only main...HEAD` (committed changes only) with the globs and
exits 1 if any changed file matches none of them. It also warns when `PLAN.md` changed.
Quote the globs. `*` matches inside one path segment and `**` matches across segments.
`BASE=<ref>` overrides `main`.

Module rules (PLAN.md §9): a module lane is `src/modules/<id>/**`. Modules are
auto-discovered (PLAN.md §3.2), so adding one never touches a shared file.

## 5. Contract: frozen

`src/core/engine-contract.ts` and `src/core/view-contract.ts` are verbatim copies of
PLAN.md §3.1. The only additions are `export` keywords and the imports `view-contract`
needs. **They are frozen.** Every change goes through the Phase 1 owner: they bump
`contractVersion` and update PLAN.md §3.1 and both files together. To experiment
without a core change, use `Step.extras`.

Summary of PLAN.md §3.1:

1. `engine-contract` (no React): `OpInput`, `Config`, `Highlight`, `Metrics`, `Step<S>`, `RunResult<S>`, `FieldSpec`, `Operation`, `SettingSpec`, `ScenarioOp`, `Scenario<S>`.
2. `view-contract` (React types): `RenderProps<S>`, and `VizModule<S, I>` with `contractVersion: 1`.
3. `engine.init(config?)` → `S`. `S` carries its resolved config. `engine.run(opId, input, prev)` → `RunResult<S>` and takes no config.
4. `S` is plain JSON (no `Map`, `Date` or classes, and no reliance on `undefined` surviving).
5. When steps exist, `RunResult.result` deep-equals `steps.at(-1).state`.
6. `error` is for **invalid input only**. A read that finds nothing is a normal operation that emits steps.
7. `init` and `run` are pure and deterministic: seeded PRNG, and a logical clock (`seq`) instead of `Date.now()`.
8. Every entity has a stable `id`. ``layoutId = `${containerId}:${entityId}` ``, and only the moving copy shares it.
9. `Render` must call `onAnimationComplete()`, even when nothing animates (`useStepTransition` handles that).
10. Every module's test calls `runConformance(module)` (PLAN.md §3.5).

## 6. Conventions (PLAN.md §8, enforced by `eslint.config.js`)

1. Modules import only `@core/*`, their own files and npm packages. `@shell` and other modules are off-limits.
2. `src/modules/*/engine/**`, `src/modules/*/lib/**` and `src/modules/*/state.ts` are **pure**. They import only `@core/engine-contract` and their own module's pure files: no React and no npm packages.
3. `src/core` imports only `src/core` and npm packages. `src/shell` imports `@core` + `@shell`. App code (`src/*`, `src/pages`) never imports a module directly; modules are found through `import.meta.glob`.
4. Tests (`*.test.ts(x)`) may also import any npm package and anything in their own module.
5. Tests assert step **`kind` sequences** and state invariants, never narration wording.
6. Use property tests (fast-check) wherever operation sequences are involved.
7. Rendering is SVG only, with `motion/react`, semantic `--viz-*` tokens and core primitives. Tombstones differ by shape **and** color.
8. Narration is 1–2 plain sentences per step and explains _why_.
9. Each step makes one conceptual change. Group long operations into chapters (`kind` prefixes) instead of compressing them.
10. Track per-module progress in `src/modules/<id>/STATUS.md`, never in PLAN.md.
