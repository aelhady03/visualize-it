/**
 * The delete operation (PLAN.md §5.2 Delete) — implemented by the
 * UPDATE/DELETE lane.
 *
 * A delete writes a TOMBSTONE through the normal write path (WAL → MemTable
 * → flush) — deletes never touch existing files. The read path treats a
 * tombstone hit as "not found" and stops; compaction may GC a tombstone only
 * when no older data for the key can exist outside the merge (the classic
 * gotcha — drop one early and the deleted value resurrects). The kept-vs-
 * dropped compaction contrast ships in Wave 4 with the compaction lanes;
 * this lane ships the tombstone write itself.
 *
 * Step kinds are the write path's with the prefix "delete.":
 *   delete.wal.append → delete.memtable.insert → (delete.memtable.freeze) →
 *   (delete.jobs.advance → delete.flush.complete) → (delete.compact.trigger).
 * The tombstone entry carries `tombstone: true` and an empty value; the
 * mechanics reuse the pure helpers of engine/write.ts (never edited).
 *
 * Pure: imports only @core/engine-contract and this module's pure files.
 * Deterministic: the entry seq comes from the logical clock (state.seq);
 * no randomness, no wall clocks.
 */

import type { Highlight, OpInput, RunResult, Step } from "@core/engine-contract";
import type { EngineState, Entry } from "../state";
import { entryBytes } from "../lib/derive";
import { resolveConfig } from "../lib/config";
import { freezeActive, insertIntoActive } from "./write";
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

export function runDelete(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  const key = input?.key;
  if (typeof key !== "string" || key.length === 0) {
    // Contract: `error` is for INVALID INPUT ONLY (empty key, unknown op id).
    return { steps: [], result: state, error: "invalid input: key must be a non-empty string" };
  }

  const cfg = resolveConfig(state.config);
  const steps: Step<EngineState>[] = [];
  let next = state;

  // 1. delete.wal.append — durability first; a delete is just another write.
  const seq = next.seq;
  const entry: Entry = { id: `e${seq}`, key, value: "", seq, tombstone: true };
  const active = next.memtables.find((m) => m.state === "active") ?? next.memtables[0];
  next = {
    ...next,
    seq: seq + 1,
    wal: next.wal.map((w) =>
      w.id === active.walSegment ? { ...w, entries: [...w.entries, entry] } : w,
    ),
    metrics: {
      ...next.metrics,
      ingestedBytes: next.metrics.ingestedBytes + key.length,
      diskBytes: next.metrics.diskBytes + entryBytes(entry),
    },
  };
  steps.push(
    step(
      "delete.wal.append",
      next,
      `A tombstone for "${key}" is appended to the WAL first — a delete is just another write, and the marker is durable before the MemTable changes.`,
      "Deletes never touch existing files: the tombstone is a durable record that outranks every older version by seq.",
      [{ id: entry.id, role: "new" }],
    ),
  );

  // 2. delete.memtable.insert — the tombstone lands in sorted key order.
  next = insertIntoActive(next, entry);
  steps.push(
    step(
      "delete.memtable.insert",
      next,
      `The tombstone lands in the active MemTable in sorted key order. Older versions of "${key}" still exist in their files, but the tombstone carries the highest seq — reads will stop at it and report the key as missing.`,
      "Latest wins applies to deletes too: a tombstone is simply the newest version of the key.",
      [{ id: entry.id, role: "new" }],
    ),
  );

  // 3. delete.memtable.freeze — cap reached (same mechanics as the write path).
  const nowActive = next.memtables.find((m) => m.state === "active") ?? next.memtables[0];
  if (nowActive.entries.length >= cfg.memtableCap) {
    const frozenId = nowActive.id;
    next = freezeActive(next);
    steps.push(
      step(
        "delete.memtable.freeze",
        next,
        `The MemTable reached its capacity (${cfg.memtableCap} entries) and froze — the tombstone moves toward disk through the exact same flush path as any value. A new active MemTable and a new WAL segment take over immediately.`,
        "Tombstones are first-class entries: only the read path and compaction treat them specially.",
        [
          { id: frozenId, role: "active" },
          { id: next.memtables[0].id, role: "new" },
          { id: next.wal[next.wal.length - 1].id, role: "new" },
        ],
      ),
    );
  }

  // 4. delete.jobs.advance + 5. delete.flush.complete — background jobs progress.
  if (next.jobs.length > 0) {
    next = incrementProgress(next);
    steps.push(
      step(
        "delete.jobs.advance",
        next,
        "While you ran this delete, background jobs made progress: every job advanced one unit toward completion.",
        "The jobs model makes flushes and compactions real and observable without stalling the write path.",
      ),
    );
    for (const job of next.jobs) {
      if (job.progress >= job.total && job.kind === "flush") {
        const memtableId = job.inputs[0];
        const sstableId = sstableIdForMemtable(memtableId);
        const flushed = next.memtables.find((m) => m.id === memtableId);
        const walId = flushed?.walSegment;
        next = completeFlushJob(next, job);
        steps.push(
          step(
            "delete.flush.complete",
            next,
            `The flush finished: its entries were split into blocks, indexed and bloom-filtered, and written as a new SSTable in L0. The immutable MemTable is dropped and its WAL segment is truncated — that is why the WAL stays bounded.`,
            "A tombstone must survive until compaction proves no older data for the key can exist outside its inputs — drop one early and the deleted value resurrects.",
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

  // 6. delete.compact.trigger — threshold met (Phase 6 builds the compaction).
  if (next.l0.length >= cfg.l0Trigger) {
    steps.push(
      step(
        "delete.compact.trigger",
        next,
        `L0 now holds ${next.l0.length} files — at the l0Trigger threshold (${cfg.l0Trigger}). A compaction would trigger here to merge them, drop stale versions, and GC tombstones once no older data for their keys can hide outside the merge.`,
        "Compaction debt: every flush adds an L0 file a read must probe. Merging them keeps read amplification bounded.",
      ),
    );
  }

  return { steps, result: next };
}
