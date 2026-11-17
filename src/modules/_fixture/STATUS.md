# _fixture — module status

The Phase 1 animation-spike module: a counter / append-only list that proves the
whole pipeline (contract → discovery → player → conformance → SVG Render).

| Area      | State                                                                 |
| --------- | --------------------------------------------------------------------- |
| state     | `seq` logical clock, items, staged `pending`, resolved `capacity`      |
| engine    | `append` (stage → commit, optional cap/full) and `clear` (mark → drop) |
| meta      | eager exports for the sidebar (1 sandbox-capable op, 1 setting)        |
| scenarios | `append-then-clear` — two appends + a clear (6 steps, 2 chapters)      |
| render    | minimal SVG rows + staged ghost; always calls `onAnimationComplete()`  |
| tests     | engine kind sequences + property test; `runConformance` green          |

## Purpose

- Gives the shell something real to render while the SSTable module is built.
- Sanity-checks the two-glob discovery, the unified-timeline player (chapters),
  and the 7 conformance checks against a non-trivial-but-tiny module.
- Documents the conventions for future module authors (see `index.test.ts`).
