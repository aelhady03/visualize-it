/**
 * Background jobs (PLAN.md §5.1 jobs model).
 *
 * Jobs advance 1 unit per subsequent user operation: a flush needs 2 units
 * (so an immutable MemTable is observable for exactly one operation after the
 * freezing write), a compaction needs inputs.length units. `advanceJobs` is
 * the combined pass; `incrementProgress` + `completeFlushJob` are split out
 * so the write path can emit one step per conceptual change (PLAN.md §8):
 * `jobs.advance` shows progress, `flush.complete` shows the SSTable landing.
 *
 * Phase 6 (compaction) will own completion semantics for kind "compaction";
 * this lane never creates one.
 */

import type { EngineState, Entry, Job, SSTable } from "../state";
import { entryBytes } from "../lib/derive";
import { add, emptyBloom } from "../lib/bloom";
import { resolveConfig } from "../lib/config";

/** New stable id for the SSTable a MemTable flushes into: "mt7" → "s7". */
export function sstableIdForMemtable(memtableId: string): string {
  return `s${memtableId.replace(/\D+/g, "")}`;
}

/**
 * Builds the immutable SSTable for a finished flush. Blocks are split from
 * the already-sorted MemTable entries (blockSize each, last block shorter),
 * the sparse index / minKey / maxKey stay DERIVED from the blocks (§5.1),
 * the bloom filter is the 16-bit k=2 teaching filter (lib/bloom.ts), and
 * `bytes` uses lib/derive's documented estimator.
 */
export function buildSSTable(id: string, entries: Entry[], blockSize: number): SSTable {
  const blocks = [];
  for (let i = 0; i < entries.length; i += blockSize) {
    blocks.push({ id: `${id}-b${blocks.length + 1}`, entries: entries.slice(i, i + blockSize) });
  }
  const bloom = emptyBloom();
  for (const e of entries) add(bloom, e.key);
  const seq = entries.reduce((max, e) => Math.max(max, e.seq), 0);
  const bytes = entries.reduce((sum, e) => sum + entryBytes(e), 0);
  return { id, seq, blocks, bloom, bytes };
}

/**
 * Every job +1 progress. A flush job also grows its renderable `output` —
 * the merge stream so far — to its first `blockSize * progress` entries
 * (capped); when progress reaches total the output is the full entry list.
 * Jobs that reach total are NOT completed here: the caller emits the
 * completion steps separately (one conceptual change per step).
 */
export function incrementProgress(state: EngineState): EngineState {
  const cfg = resolveConfig(state.config);
  const jobs = state.jobs.map((job) => {
    const progress = job.progress + 1;
    if (job.kind === "flush") {
      const mt = state.memtables.find((m) => m.id === job.inputs[0]);
      const entries = mt ? mt.entries : [];
      const output =
        progress >= job.total ? entries : entries.slice(0, cfg.blockSize * progress);
      return { ...job, progress, output };
    }
    return { ...job, progress };
  });
  return { ...state, jobs };
}

/**
 * Completes one flush job: build the SSTable from the immutable MemTable's
 * entries, land it in l0 (appended — under leveled, l0 is oldest-first, and
 * files land in flush order), drop the MemTable, truncate its WAL segment
 * (that is why the WAL stays bounded), and update the byte metrics.
 */
export function completeFlushJob(state: EngineState, job: Job): EngineState {
  const memtable = state.memtables.find((m) => m.id === job.inputs[0]);
  if (!memtable) {
    // Defensive: a job whose input vanished (should not happen — inputs stay
    // in state until their job completes). Drop the job without side effects.
    return { ...state, jobs: state.jobs.filter((j) => j.id !== job.id) };
  }
  const cfg = resolveConfig(state.config);
  const sstable = buildSSTable(sstableIdForMemtable(memtable.id), memtable.entries, cfg.blockSize);
  const walSegment = state.wal.find((w) => w.id === memtable.walSegment);
  const walBytes = walSegment ? walSegment.entries.reduce((sum, e) => sum + entryBytes(e), 0) : 0;
  return {
    ...state,
    l0: [...state.l0, sstable],
    memtables: state.memtables.filter((m) => m.id !== memtable.id),
    wal: state.wal.filter((w) => w.id !== memtable.walSegment),
    jobs: state.jobs.filter((j) => j.id !== job.id),
    metrics: {
      ...state.metrics,
      bytesWritten: state.metrics.bytesWritten + sstable.bytes,
      diskBytes: state.metrics.diskBytes + sstable.bytes - walBytes,
    },
  };
}

/**
 * The combined advance: every job +1 progress, then every job that reached
 * its total completes (flush → SSTable lands in l0). Used directly where the
 * caller does not need per-step snapshots.
 */
export function advanceJobs(state: EngineState): EngineState {
  let next = incrementProgress(state);
  for (const job of next.jobs) {
    if (job.progress >= job.total && job.kind === "flush") {
      next = completeFlushJob(next, job);
    }
  }
  return next;
}
