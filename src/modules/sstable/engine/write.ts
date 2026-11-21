/**
 * The write operation (PLAN.md §5.2 Write, steps 1–6).
 *
 * Pure: one function of (input, prev) → RunResult<EngineState>. Deterministic
 * — the entry seq comes from the logical clock (state.seq), never a real
 * clock, and there is no randomness.
 *
 * Step order per op (a step is emitted only when its condition holds):
 *   1. wal.append      — durability first: record appended to the active WAL.
 *   2. memtable.insert — sorted insert into the active MemTable.
 *   3. memtable.freeze — cap reached: active → immutable, a NEW active
 *                        MemTable + NEW WAL segment appear immediately, and
 *                        a flush job (2 units) starts. Writes never block.
 *   4. jobs.advance    — every job +1 progress (including leftovers).
 *   5. flush.complete  — a flush job that reached its total: SSTable lands
 *                        in l0, the immutable MemTable is dropped, its WAL
 *                        segment is truncated.
 *   6. compact.trigger — l0.length ≥ l0Trigger: narration notes a compaction
 *                        would trigger. No job is created here — Phase 6
 *                        owns compaction.
 */

import type { Highlight, OpInput, RunResult, Step } from "@core/engine-contract";
import type { EngineState, Entry } from "../state";
import { entryBytes } from "../lib/derive";
import { resolveConfig } from "../lib/config";
import { completeFlushJob, incrementProgress, sstableIdForMemtable } from "./jobs";

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
 * Sorted insert into the active MemTable. If the key is already there, the
 * entry REPLACES the old one in place — the write path is also the
 * mechanical path for update (PLAN.md §5.2 Update): a blind write, and an
 * in-memory overwrite means the old version never reaches disk. The WAL
 * still holds both records: every write is durable on its own.
 */
export function insertIntoActive(state: EngineState, entry: Entry): EngineState {
  return {
    ...state,
    memtables: state.memtables.map((mt) => {
      if (mt.state !== "active") return mt;
      const existing = mt.entries.findIndex((e) => e.key === entry.key);
      if (existing >= 0) {
        const entries = [...mt.entries];
        entries[existing] = entry;
        return { ...mt, entries };
      }
      let pos = mt.entries.findIndex((e) => e.key > entry.key);
      if (pos === -1) pos = mt.entries.length;
      return { ...mt, entries: [...mt.entries.slice(0, pos), entry, ...mt.entries.slice(pos)] };
    }),
  };
}

/**
 * Freeze: the active MemTable becomes immutable; a NEW active MemTable and a
 * NEW WAL segment are created immediately, and a flush job (2 units) starts
 * so the frozen table becomes an SSTable over the next two operations.
 */
export function freezeActive(state: EngineState): EngineState {
  const frozen = state.memtables.find((m) => m.state === "active");
  if (!frozen) return state;
  const stamp = state.seq; // the logical clock: unique per op, so ids never collide
  return {
    ...state,
    wal: [...state.wal, { id: `w${stamp}`, entries: [] }],
    memtables: [
      { id: `mt${stamp}`, state: "active" as const, entries: [], walSegment: `w${stamp}` },
      ...state.memtables.map((m) =>
        m.id === frozen.id ? { ...m, state: "immutable" as const } : m,
      ),
    ],
    jobs: [
      ...state.jobs,
      { id: `j${stamp}`, kind: "flush" as const, inputs: [frozen.id], output: [], progress: 0, total: 2 },
    ],
  };
}

export function runWrite(input: OpInput | undefined, prev: EngineState): RunResult<EngineState> {
  const key = input?.key;
  if (typeof key !== "string" || key.length === 0) {
    // Contract: `error` is for INVALID INPUT ONLY (empty key, unknown op id).
    return { steps: [], result: prev, error: "invalid input: key must be a non-empty string" };
  }
  const rawValue = input?.value;
  const value =
    typeof rawValue === "string" ? rawValue : rawValue === undefined ? "" : String(rawValue);

  const cfg = resolveConfig(prev.config);
  const steps: Step<EngineState>[] = [];
  let state = prev;

  // 1. wal.append — durability before anything else.
  const seq = state.seq;
  const entry: Entry = { id: `e${seq}`, key, value, seq };
  const active = state.memtables.find((m) => m.state === "active") ?? state.memtables[0];
  state = {
    ...state,
    seq: seq + 1,
    wal: state.wal.map((w) =>
      w.id === active.walSegment ? { ...w, entries: [...w.entries, entry] } : w,
    ),
    metrics: {
      ...state.metrics,
      ingestedBytes: state.metrics.ingestedBytes + key.length + value.length,
      diskBytes: state.metrics.diskBytes + entryBytes(entry),
    },
  };
  steps.push(
    step(
      "wal.append",
      state,
      `The record for "${key}" is appended to the active WAL segment before anything else — durability first; the WAL is what makes an in-memory write survive a crash.`,
      "Write-ahead logging: the log entry hits durable storage before the MemTable changes.",
      [
        { id: entry.id, role: "new" },
        { id: active.walSegment, role: "active" },
      ],
    ),
  );

  // 2. memtable.insert — sorted insert into the active MemTable.
  state = insertIntoActive(state, entry);
  steps.push(
    step(
      "memtable.insert",
      state,
      `The entry lands in the active MemTable in sorted key order — reads see it immediately. Each write gets the next sequence number, and the highest seq always wins.`,
      "The MemTable is the newest layer of the tree: reads check it first, so this write is visible to the very next read, before it ever touches disk.",
      [
        { id: entry.id, role: "new" },
        { id: active.id, role: "active" },
      ],
    ),
  );

  // 3. memtable.freeze — cap reached.
  const nowActive = state.memtables.find((m) => m.state === "active") ?? state.memtables[0];
  if (nowActive.entries.length >= cfg.memtableCap) {
    const frozenId = nowActive.id;
    state = freezeActive(state);
    steps.push(
      step(
        "memtable.freeze",
        state,
        `The MemTable reached its capacity (${cfg.memtableCap} entries) and froze. A new active MemTable and a new WAL segment take over immediately, and a flush job starts in the background — writes never block on disk I/O.`,
        "Freezing converts the in-memory table into a queued background job instead of making the next write wait.",
        [
          { id: frozenId, role: "active" },
          { id: state.memtables[0].id, role: "new" },
          { id: state.wal[state.wal.length - 1].id, role: "new" },
          { id: state.jobs[state.jobs.length - 1].id, role: "new" },
        ],
      ),
    );
  }

  // 4. jobs.advance + 5. flush.complete — background jobs make progress.
  if (state.jobs.length > 0) {
    state = incrementProgress(state);
    steps.push(
      step(
        "jobs.advance",
        state,
        "While you ran this write, background jobs made progress: every job advanced one unit toward completion.",
        "The jobs model makes flushes and compactions real and observable without stalling the write path.",
        state.jobs.flatMap((j) => j.output.map((e) => ({ id: e.id, role: "active" as const }))),
      ),
    );
    for (const job of state.jobs) {
      if (job.progress >= job.total && job.kind === "flush") {
        const memtableId = job.inputs[0];
        const sstableId = sstableIdForMemtable(memtableId);
        const flushed = state.memtables.find((m) => m.id === memtableId);
        const walId = flushed?.walSegment;
        state = completeFlushJob(state, job);
        steps.push(
          step(
            "flush.complete",
            state,
            `The flush finished: its entries were split into blocks, indexed and bloom-filtered, and written as a new SSTable in L0. The immutable MemTable is dropped and its WAL segment is truncated — that is why the WAL stays bounded.`,
            "Once data is safely in an SSTable, the WAL segment that protected it can go.",
            [
              { id: sstableId, role: "new" },
              { id: memtableId, role: "removed" },
              ...(walId ? [{ id: walId, role: "removed" as const }] : []),
            ],
          ),
        );
      }
    }
  }

  // 6. compact.trigger — threshold met (Phase 6 builds the compaction itself).
  if (state.l0.length >= cfg.l0Trigger) {
    const compactionInFlight = state.jobs.some((j) => j.kind === "compaction");
    steps.push(
      step(
        "compact.trigger",
        state,
        compactionInFlight
          ? `L0 now holds ${state.l0.length} files — at the l0Trigger threshold (${cfg.l0Trigger}) — while a compaction is still merging. New flushes would have to wait: compaction debt has caught up with the write path.`
          : `L0 now holds ${state.l0.length} files — at the l0Trigger threshold (${cfg.l0Trigger}). A compaction would merge them into fewer files next, because every L0 file a read must probe is read amplification.`,
        compactionInFlight
          ? "Writes never block on their own flush, but they do block when L0 fills faster than compaction drains it."
          : "Compaction debt: every flush adds an L0 file a read must probe. Merging them keeps read amplification bounded.",
        state.l0.map((f) => ({ id: f.id, role: "active" as const })),
      ),
    );
  }

  return { steps, result: state };
}
