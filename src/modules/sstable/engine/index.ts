/**
 * Engine entry (PLAN.md §6): init + run dispatcher.
 *
 * Pure: imports only @core/engine-contract and this module's pure files
 * (state.ts, lib/**, engine/**). The engine contract is frozen v1 — config
 * is passed to init only; `S` (EngineState) carries the resolved config.
 */

import type { Config, OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";
import { resolveConfig } from "../lib/config";
import { runWrite } from "./write";

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
 * Dispatcher. `write` is implemented (engine/write.ts); every other op id
 * reports "not implemented yet" without emitting steps. `prev` must come
 * from init() or a previous result.
 */
export function run(
  opId: string,
  input: OpInput | undefined,
  prev: EngineState,
): RunResult<EngineState> {
  switch (opId) {
    case "write":
      return runWrite(input, prev);
    default:
      return { steps: [], result: prev, error: "not implemented yet" };
  }
}
