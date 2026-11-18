/**
 * The read operation (PLAN.md §5.2 Read) — STUB.
 *
 * Lane: the READ lane replaces this file with the real implementation.
 * Probe order: active MemTable → immutable MemTables → L0 newest-first →
 * levels (leveled only, at most one file per level). Per file: range check,
 * bloom filter, sparse index binary search, block scan. Max-seq reconciliation
 * (the R1 fix): keep probing while a newer file can shadow the hit. A
 * tombstone hit stops the search with "not found". Step kinds start with
 * "read." (e.g. read.memtable-active, read.l0, read.done); a bloom false
 * positive is a normal step, not an error (contract §3.1).
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runRead(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { OpInput, RunResult } from "@core/engine-contract";
import type { EngineState } from "../state";

export function runRead(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  void input; // replaced by the read lane
  return { steps: [], result: state, error: "not implemented" };
}
