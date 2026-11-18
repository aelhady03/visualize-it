/**
 * Engine entry (PLAN.md §6): init + run dispatcher.
 *
 * Written ONCE by the Wave 3 module lead (lane: lead). The dispatcher is a
 * REGISTRY: op id → runner. Every runner has the same signature,
 * `(state, input) => RunResult<EngineState>`, so a lane replaces exactly its
 * stub file (engine/read.ts etc.) and the registry picks it up unchanged.
 *
 * `write` is wired to the existing engine/write.ts through a small adapter —
 * write.ts keeps its historical `(input, state)` argument order.
 *
 * Pure: imports only @core/engine-contract and this module's pure files
 * (state.ts, lib/**, engine/**). The engine contract is frozen v1 — config
 * is passed to init only; `S` (EngineState) carries the resolved config.
 */

import type { Config, OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";
import { resolveConfig } from "../lib/config";
import { runWrite } from "./write";
import { runRead } from "./read";
import { runUpdate } from "./update";
import { runDelete } from "./delete";
import { runCompact } from "./compact";
import { runCrash } from "./crash";
import { runBulk } from "./bulk";

/**
 * One op runner. This is the EXACT signature every engine lane must keep when
 * it replaces its stub file:
 *
 *   export function runX(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */
export type OpRunner = (state: EngineState, input: OpInput | undefined) => RunResult<EngineState>;

/** The registry: op id → runner. Lanes add no entries here; they fill stubs. */
const ops: Record<string, OpRunner> = {
  write: (state, input) => runWrite(input, state),
  read: runRead,
  update: runUpdate,
  delete: runDelete,
  compact: runCompact,
  crash: runCrash,
  "write-bulk": runBulk,
};

/** Fresh engine state: one active MemTable + its WAL segment, empty levels. */
export function init(config?: Config): EngineState {
  const resolved = resolveConfig(config);
  return {
    seq: 1,
    wal: [{ id: "w1", entries: [] }],
    memtables: [{ id: "mt1", state: "active", entries: [], walSegment: "w1" }],
    l0: [],
    levels: [],
    jobs: [],
    config: { ...resolved }, // S carries the resolved config (contract §3.1)
    metrics: { ingestedBytes: 0, bytesWritten: 0, diskBytes: 0, lastReadFiles: 0, lastReadBlocks: 0 },
  };
}

/**
 * Dispatcher. `write` is implemented (engine/write.ts); every other declared
 * op routes to its stub runner, which reports "not implemented" without
 * emitting steps until its lane fills it in. Unknown op ids are invalid
 * input. `prev` must come from init() or a previous result.
 */
export function run(
  opId: string,
  input: OpInput | undefined,
  prev: EngineState,
): RunResult<EngineState> {
  const op = ops[opId];
  if (!op) {
    return { steps: [], result: prev, error: "not implemented yet" };
  }
  return op(prev, input);
}
