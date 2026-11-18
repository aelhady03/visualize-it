/**
 * The crash & recover operation (PLAN.md §5.2 Crash).
 *
 * 1. `crash.memory-wiped` — simulate the crash: every MemTable is wiped
 *    (memory does not survive), in-flight jobs and the seq counter vanish
 *    with them. The WAL segments and the SSTables on disk are untouched.
 * 2. `crash.replay-segment` — one step PER unflushed WAL segment, oldest
 *    first: each segment is replayed into a rebuilt MemTable using the write
 *    path's own insert semantics (sorted insert, in-place replace), so the
 *    table comes back exactly as it was in memory. The newest segment — the
 *    one the active table was appending to — is rebuilt as the new ACTIVE
 *    MemTable; older segments come back as immutable tables.
 * 3. `crash.flush-requeued` — every replayed IMMUTABLE MemTable gets a fresh
 *    flush job (2 units) re-queued, or its data would never reach disk: the
 *    jobs themselves were lost with the crash, but the need to flush is
 *    derived from the data. The active table takes writes and needs no job.
 * 4. `crash.seq-restored` — the seq counter was in-memory state as well, so
 *    it is rebuilt as one past the highest seq found anywhere in the WAL and
 *    the SSTables. Nothing else is truncated: replay never touches the log;
 *    flushed segments were already gone, which is why recovery is cheap.
 *
 * Deterministic: pure functions of state, no randomness, no real clock.
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runCrash(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { Highlight, OpInput, RunResult, Step } from "@core/engine-contract";
import type { EngineState, Job, MemTable, WalSegment } from "../state";
import { sstableEntries } from "../lib/derive";
import { insertIntoActive } from "./write";

function step(
  kind: string,
  state: EngineState,
  narration: string,
  why?: string,
  highlights?: Highlight[],
): Step<EngineState> {
  return { kind, state, narration, why, highlights };
}

/**
 * Stable MemTable id for a WAL segment, "w3" → "mt3" — the same pairing rule
 * `freezeActive` used when the segment and its table were created. Reusing it
 * keeps the `memtable:<mtId>:<entryId>` layoutIds identical across the crash,
 * so the rebuilt rows FLIP back into place.
 */
export function memtableIdForSegment(segmentId: string): string {
  return `mt${segmentId.replace(/\D+/g, "")}`;
}

/**
 * Rebuild one MemTable from its WAL segment. Replay walks the records in
 * append order through the write path's own `insertIntoActive` — sorted
 * insert with in-place replace — so a key written twice before the crash
 * comes back once, as its latest version, exactly like the table in memory.
 * The WAL itself is never rewritten or truncated.
 */
export function replaySegment(state: EngineState, segment: WalSegment): MemTable {
  const provisional: MemTable = {
    id: memtableIdForSegment(segment.id),
    state: "active", // provisional — the caller decides active vs immutable
    entries: [],
    walSegment: segment.id,
  };
  let scratch: EngineState = { ...state, memtables: [provisional] };
  for (const entry of segment.entries) {
    scratch = insertIntoActive(scratch, entry);
  }
  return scratch.memtables[0];
}

/** Highest seq anywhere durable: unflushed WAL records + every SSTable. */
export function maxDurableSeq(state: EngineState): number {
  let max = 0;
  for (const segment of state.wal) {
    for (const entry of segment.entries) max = Math.max(max, entry.seq);
  }
  for (const sst of [...state.l0, ...state.levels.flat()]) {
    for (const entry of sstableEntries(sst)) max = Math.max(max, entry.seq);
  }
  return max;
}

/**
 * Stable flush-job id for a rebuilt MemTable, "mt3" → "j3" — derived from the
 * memtable id (not from `state.seq`, which is wiped mid-replay), so recovery
 * is deterministic and unique per table no matter how many segments replay.
 */
export function jobIdForMemtable(memtableId: string): string {
  return `j${memtableId.replace(/\D+/g, "")}`;
}

export function runCrash(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  void input; // crash takes no input
  const steps: Step<EngineState>[] = [];

  // 1. crash.memory-wiped — memory is gone; the log and the files survive.
  const wipedMemtables = state.memtables.map((m) => m.id);
  const wipedJobs = state.jobs.map((j) => j.id);
  let next: EngineState = { ...state, seq: 0, memtables: [], jobs: [] };
  steps.push(
    step(
      "crash.memory-wiped",
      next,
      "The process died: the MemTables are gone — memory does not survive a crash — and every in-flight job and the seq counter vanish with them. The WAL segments and SSTables on disk are untouched.",
      "Everything in RAM is lost. Only what was made durable — the WAL and the flushed SSTables — can come back.",
      [
        ...wipedMemtables.map((id): Highlight => ({ id, role: "removed" })),
        ...wipedJobs.map((id): Highlight => ({ id, role: "removed" })),
      ],
    ),
  );

  // 2. crash.replay-segment — one step per unflushed segment, oldest first.
  // The newest segment was the one the active table was appending to, so it
  // comes back as the new active MemTable; older ones return as immutable.
  for (let i = 0; i < state.wal.length; i++) {
    const segment = state.wal[i];
    const isActive = i === state.wal.length - 1;
    const memtable: MemTable = {
      ...replaySegment(state, segment),
      state: isActive ? "active" : "immutable",
    };
    next = {
      ...next,
      memtables: isActive ? [memtable, ...next.memtables] : [...next.memtables, memtable],
    };
    steps.push(
      step(
        "crash.replay-segment",
        next,
        isActive
          ? `The newest segment ${segment.id} replays into ${memtable.id}, rebuilt as the active MemTable — writes can resume right where they left off.`
          : `Segment ${segment.id} replays into ${memtable.id}, rebuilt as an immutable MemTable. Recovery reads the durable log; it never guesses at what was in memory.`,
        "This is what the WAL is for: every record since that table was created survives, in order.",
        [
          { id: segment.id, role: "active" },
          { id: memtable.id, role: "new" },
          ...segment.entries.map((e): Highlight => ({ id: e.id, role: "new" })),
        ],
      ),
    );

    // 3. crash.flush-requeued — a rebuilt immutable table still owes a flush:
    // the jobs themselves were lost, so recovery re-queues one (2 units) or
    // the replayed data would never reach disk.
    if (!isActive) {
      const job: Job = {
        id: jobIdForMemtable(memtable.id),
        kind: "flush",
        inputs: [memtable.id],
        output: [],
        progress: 0,
        total: 2,
      };
      next = { ...next, jobs: [...next.jobs, job] };
      steps.push(
        step(
          "crash.flush-requeued",
          next,
          `Recovery re-queues the flush for ${memtable.id}: a fresh 2-unit flush job starts so the replayed data still reaches disk as an SSTable — the crash cost it nothing but time.`,
          "A rebuilt immutable table is in-memory data waiting to be flushed; without a job it would never leave memory.",
          [
            { id: job.id, role: "new" },
            { id: memtable.id, role: "active" },
          ],
        ),
      );
    }
  }

  // 4. crash.seq-restored — the counter was in-memory state too.
  const restoredSeq = maxDurableSeq(state) + 1;
  next = { ...next, seq: restoredSeq };
  steps.push(
    step(
      "crash.seq-restored",
      next,
      `The seq counter was in-memory state too, so it is rebuilt as one past the highest seq found anywhere in the WAL and the SSTables (${restoredSeq}). Flushed segments were already truncated, which is why recovery replays so little.`,
      "Without the restored counter a new write could reuse an old seq number and lose to a stale version.",
    ),
  );

  return { steps, result: next };
}
