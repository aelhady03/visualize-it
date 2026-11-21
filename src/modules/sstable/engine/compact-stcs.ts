/**
 * Size-tiered compaction (STCS) — PLAN.md §5.2 Compact, the STCS half.
 * Lane: STCS compaction lane. `engine/compact.ts` dispatches here when
 * `state.config.strategy === "stcs"`; this file replaces the stub and keeps
 * the exact export signature:
 *
 *   export function runCompactStcs(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 *
 * What STCS does here (§5.2 Compact):
 *   - Group L0 files into similar-size buckets (size ratio ~2x, files sorted
 *     by bytes first so grouping is deterministic even though L0 order is
 *     meaningless under stcs).
 *   - A bucket with >= stcsMinThreshold files merges into ONE new SSTable.
 *     The explicit `compact` op runs the same trigger path the write path
 *     narrates (write.ts's `compact.trigger` step), so compaction jobs start
 *     here and here only.
 *   - The merge is a jobs-driven animated merge-sort: a Job (kind
 *     'compaction', inputs = merged file ids) is created and advances 1 unit
 *     per subsequent operation (PLAN.md §5.1 jobs model), just like flush
 *     jobs. Its `output` is the merge stream so far — the full merge via
 *     lib/merge.ts, truncated to the job's progress — which is what renders
 *     mid-merge.
 *   - Stale versions drop out of the stream; tombstones follow the STCS GC
 *     rule (§5.2 Delete): a tombstone drops only if NO OLDER file outside
 *     the merge — lower max seq, whose range covers the key and whose bloom
 *     says "maybe" — can still hold the key. A NEWER file holding the key
 *     does NOT block the drop (it wins at read time anyway).
 *   - Transient disk need up to ~2x during a big merge is narrated.
 *   - Metrics: bytesWritten += merged output bytes (write amplification);
 *     diskBytes += new file - consumed inputs.
 *   - Write-stall narration step when l0.length >= l0Trigger and a
 *     compaction job is still in flight: compaction debt slowing down writes.
 *
 * Step kinds all start with "compact." (compact.advance, compact.flush-complete,
 * compact.complete, compact.start, compact.stall, compact.none).
 *
 * Pure: imports only @core/engine-contract and this module's pure files
 * (state.ts, lib/**, engine/jobs.ts). Deterministic: logical `seq` clock for
 * job/file ids, no Math.random, no Date.now.
 */

import type { Highlight, OpInput, RunResult, Step } from "@core/engine-contract";
import type { EngineState, Entry, Job, SSTable } from "../state";
import { resolveConfig } from "../lib/config";
import { maybe } from "../lib/bloom";
import { sstableEntries, sstableMinKey, sstableMaxKey } from "../lib/derive";
import { mergeRuns, type KeepTombstone } from "../lib/merge";
import { buildSSTable, completeFlushJob, incrementProgress, sstableIdForMemtable } from "./jobs";

/**
 * Bucket size ratio: files within ~2x of each other form one size tier
 * (real engines use ~10; 2 is the teaching value so tiers stay visible).
 */
export const STCS_SIZE_RATIO = 2;

function step(
  kind: string,
  state: EngineState,
  narration: string,
  why?: string,
  highlights?: Highlight[],
): Step<EngineState> {
  return { kind, state, narration, why, highlights };
}

// ---------------------------------------------------------------------------
// Size-tiered bucket grouping (deterministic, order-independent)
// ---------------------------------------------------------------------------

/**
 * Group files into similar-size buckets: sort by bytes ascending, then walk
 * once, starting a new bucket whenever the next file is >= `ratio` times the
 * bucket's smallest file. L0 order is meaningless under stcs, so the byte
 * sort is what makes grouping deterministic.
 */
export function groupStcsBuckets(files: SSTable[], ratio: number = STCS_SIZE_RATIO): SSTable[][] {
  const sorted = [...files].sort(
    (a, b) => a.bytes - b.bytes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const buckets: SSTable[][] = [];
  for (const file of sorted) {
    const bucket = buckets[buckets.length - 1];
    const smallest = bucket?.[0];
    if (bucket !== undefined && smallest !== undefined && file.bytes < smallest.bytes * ratio) {
      bucket.push(file);
    } else {
      buckets.push([file]);
    }
  }
  return buckets;
}

/**
 * The bucket to merge next: the qualifying bucket (>= minThreshold files)
 * with the MOST files; ties go to the larger total bytes, then the smallest
 * first-file id. Deterministic, so the merge choice never depends on L0
 * array order.
 */
export function pickStcsBucket(l0: SSTable[], minThreshold: number): SSTable[] | null {
  let best: SSTable[] | null = null;
  const totalBytes = (bucket: SSTable[]): number => bucket.reduce((sum, f) => sum + f.bytes, 0);
  for (const bucket of groupStcsBuckets(l0)) {
    if (bucket.length < minThreshold) continue;
    if (best === null) {
      best = bucket;
      continue;
    }
    if (bucket.length > best.length) {
      best = bucket;
    } else if (bucket.length === best.length) {
      const bucketBytes = totalBytes(bucket);
      const bestBytes = totalBytes(best);
      if (bucketBytes > bestBytes || (bucketBytes === bestBytes && bucket[0].id < best[0].id)) {
        best = bucket;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The STCS tombstone GC rule (§5.2 Delete)
// ---------------------------------------------------------------------------

/**
 * "Can this file hold this key?" — conservative: range covers the key AND
 * the bloom filter says "maybe". A bloom false positive answers "yes" and
 * keeps the tombstone alive, which is the SAFE direction: keeping a
 * tombstone is always correct, dropping it wrongly resurrects a deleted key.
 */
function fileMayContainKey(file: SSTable, key: string): boolean {
  const min = sstableMinKey(file);
  const max = sstableMaxKey(file);
  if (min === null || max === null) return false;
  if (key < min || key > max) return false;
  return maybe(file.bloom, key);
}

/**
 * The STCS GC policy for one merge: drop the winning tombstone only when no
 * OLDER file outside the merge (lower max seq than the tombstone) can still
 * hold the key. A NEWER file holding the key does NOT block the drop — the
 * newer version wins at read time regardless. (Real-world extra: Cassandra
 * additionally waits gc_grace_seconds; that detail is narrated, not modeled.)
 */
export function stcsGcPolicy(inputFiles: SSTable[], otherFiles: SSTable[]): KeepTombstone {
  void inputFiles;
  return (tombstone) => {
    for (const file of otherFiles) {
      if (file.seq < tombstone.seq && fileMayContainKey(file, tombstone.key)) {
        return true; // an older copy can exist outside the merge → tombstone must survive
      }
    }
    return false; // nothing older can hold the key → the tombstone can go
  };
}

// ---------------------------------------------------------------------------
// The merge itself
// ---------------------------------------------------------------------------

/** Result of one size-tiered merge: the surviving run + every dropped entry. */
export interface StcsMergePlan {
  /** The merged run: stale versions and eligible tombstones removed. */
  output: Entry[];
  /** Every input entry that does not survive (stale versions, GC'd tombstones). */
  dropped: Entry[];
}

/**
 * Merge the input files into one sorted run with lib/merge.ts (highest seq
 * wins — the R1 reconciliation) and the STCS GC policy applied to the WHOLE
 * merge at once (group-aware policy, never pairwise-folded — see merge.ts).
 */
export function stcsMergePlan(inputFiles: SSTable[], otherFiles: SSTable[]): StcsMergePlan {
  const runs = inputFiles.map((file) => sstableEntries(file));
  const output = mergeRuns(runs, stcsGcPolicy(inputFiles, otherFiles));
  const survivors = new Set(output.map((e) => e.id));
  const dropped = runs.flat().filter((e) => !survivors.has(e.id));
  return { output, dropped };
}

// ---------------------------------------------------------------------------
// Compaction job helpers (job creation, stream growth, completion)
// ---------------------------------------------------------------------------

/** The input files a compaction job consumes, and every other L0 file. */
export function compactionJobFiles(
  job: Job,
  state: EngineState,
): { inputs: SSTable[]; others: SSTable[] } {
  const all = state.l0;
  const inputs = job.inputs
    .map((id) => all.find((f) => f.id === id))
    .filter((f): f is SSTable => f !== undefined);
  const others = all.filter((f) => !job.inputs.includes(f.id));
  return { inputs, others };
}

/**
 * The merge stream so far for a compaction job: the full GC'd merge,
 * truncated to the job's progress (grows entry by entry as the job advances
 * — the mid-merge snapshots the player renders). At progress >= total this
 * is the complete output run.
 */
export function compactionJobOutput(job: Job, state: EngineState): Entry[] {
  const { inputs, others } = compactionJobFiles(job, state);
  const { output } = stcsMergePlan(inputs, others);
  if (job.total <= 0) return output;
  const count = Math.ceil((output.length * job.progress) / job.total);
  return output.slice(0, count);
}

/**
 * Stable id of the merged SSTable a compaction job produces: `s<stamp>` where
 * the stamp is the job's creation seq (the same id family flushes use).
 * Unique because every job creation consumes one logical-clock value.
 */
export function compactionOutputId(job: Job): string {
  return `s${job.id.replace(/\D+/g, "")}`;
}

/**
 * The logical-clock stamp a new compaction job gets: `state.seq`, unless a
 * job present AT THE START of this op already holds that stamp — a flush
 * created by the most recent write takes the post-increment seq as its id
 * stamp, and it may complete and disappear within this same op, so the floor
 * must be computed from the ORIGINAL state before any completion. In that
 * case the next free stamp is the highest job stamp + 1, so a compaction
 * started in the same op a flush completes never reuses an id.
 */
function nextCompactionStamp(stateAtOpStart: EngineState): number {
  const digits = (id: string): number => Number(id.replace(/\D+/g, "")) || 0;
  let stamp = stateAtOpStart.seq;
  for (const job of stateAtOpStart.jobs) {
    const d = digits(job.id);
    if (d >= stamp) stamp = d + 1;
  }
  return stamp;
}

/**
 * Start a compaction job over a bucket: kind 'compaction', inputs = the
 * bucket's file ids, progress 0 of inputs.length units. Consumes one logical
 * clock value so job and output-file ids stay unique across operations.
 */
function startCompactionJob(state: EngineState, bucket: SSTable[], stamp: number): EngineState {
  return {
    ...state,
    seq: stamp + 1,
    jobs: [
      ...state.jobs,
      {
        id: `j${stamp}`,
        kind: "compaction" as const,
        inputs: bucket.map((f) => f.id),
        output: [],
        progress: 0,
        total: bucket.length,
      },
    ],
  };
}

/**
 * Complete a compaction job: merge the inputs with the GC rule, drop the
 * consumed files from L0, land the merged run as ONE new SSTable (unless the
 * merge dropped everything), and update metrics. `bytesWritten` grows by the
 * output bytes (write amplification); `diskBytes` swaps inputs for the output.
 */
function completeCompactionJob(
  state: EngineState,
  job: Job,
): { state: EngineState; newFile: SSTable | null } {
  const cfg = resolveConfig(state.config);
  const { inputs, others } = compactionJobFiles(job, state);
  const { output } = stcsMergePlan(inputs, others);
  const removedBytes = inputs.reduce((sum, f) => sum + f.bytes, 0);
  const removedIds = new Set(inputs.map((f) => f.id));
  const l0 = state.l0.filter((f) => !removedIds.has(f.id));
  const jobs = state.jobs.filter((j) => j.id !== job.id);
  if (output.length === 0) {
    // Every surviving key was an eligible tombstone — nothing to write back.
    return {
      state: { ...state, l0, jobs, metrics: { ...state.metrics, diskBytes: state.metrics.diskBytes - removedBytes } },
      newFile: null,
    };
  }
  const sstable = buildSSTable(compactionOutputId(job), output, cfg.blockSize);
  return {
    state: {
      ...state,
      l0: [...l0, sstable],
      jobs,
      metrics: {
        ...state.metrics,
        bytesWritten: state.metrics.bytesWritten + sstable.bytes,
        diskBytes: state.metrics.diskBytes + sstable.bytes - removedBytes,
      },
    },
    newFile: sstable,
  };
}

/** Fill every in-flight compaction job's renderable merge stream. */
function fillCompactionStreams(state: EngineState): EngineState {
  return {
    ...state,
    jobs: state.jobs.map((job) =>
      job.kind === "compaction" ? { ...job, output: compactionJobOutput(job, state) } : job,
    ),
  };
}

// ---------------------------------------------------------------------------
// The operation
// ---------------------------------------------------------------------------

/**
 * The compact operation under STCS. Step order per op:
 *
 *   1. compact.advance        — every background job +1 unit; compaction
 *                               jobs' merge streams grow with the progress.
 *   2. compact.flush-complete — a flush job that reached its total: SSTable
 *                               lands in L0, WAL truncated.
 *   3. compact.complete       — a compaction job that reached its total: the
 *                               merged run lands in L0, inputs consumed,
 *                               metrics updated.
 *   4. compact.start          — no compaction in flight and a similar-size
 *                               bucket has >= stcsMinThreshold files: the
 *                               job starts (transient ~2x disk narrated).
 *      compact.none           — nothing to advance and no qualifying bucket.
 *   5. compact.stall          — l0.length >= l0Trigger while a compaction job
 *                               is still in flight: new flushes would stall.
 */
export function runCompactStcs(
  state: EngineState,
  input: OpInput | undefined,
): RunResult<EngineState> {
  void input; // compact is a no-input op (meta.ts declares no inputSchema)
  const cfg = resolveConfig(state.config);
  const steps: Step<EngineState>[] = [];
  const stampFloor = nextCompactionStamp(state); // computed BEFORE any job completes
  let s = state;

  // 1. compact.advance — background jobs make progress.
  if (s.jobs.length > 0) {
    s = fillCompactionStreams(incrementProgress(s));
    steps.push(
      step(
        "compact.advance",
        s,
        "While you ran this compact, background jobs advanced one unit each. The merge stream grows entry by entry as a compaction job folds its input runs together.",
        "Jobs advance 1 unit per user operation — the demo's stand-in for real background I/O progress.",
        s.jobs.flatMap((j) => j.output.map((e) => ({ id: e.id, role: "active" as const }))),
      ),
    );

    // 2. compact.flush-complete — flushes and merges share the job queue.
    for (const job of [...s.jobs]) {
      if (!s.jobs.some((j) => j.id === job.id)) continue; // already completed
      if (job.kind !== "flush" || job.progress < job.total) continue;
      const memtableId = job.inputs[0];
      const sstableId = sstableIdForMemtable(memtableId);
      const flushed = s.memtables.find((m) => m.id === memtableId);
      const walId = flushed?.walSegment;
      s = completeFlushJob(s, job);
      steps.push(
        step(
          "compact.flush-complete",
          s,
          `A flush job finished: its entries became a new SSTable in L0 and its WAL segment was truncated. Flushes and merges share the same background job queue.`,
          "Once data is safely in an SSTable, the WAL segment that protected it can go.",
          [
            { id: sstableId, role: "new" },
            { id: memtableId, role: "removed" },
            ...(walId ? [{ id: walId, role: "removed" as const }] : []),
          ],
        ),
      );
    }

    // 3. compact.complete — a merge that reached its total lands in L0.
    for (const job of [...s.jobs]) {
      if (!s.jobs.some((j) => j.id === job.id)) continue;
      if (job.kind !== "compaction" || job.progress < job.total) continue;
      const inputIds = [...job.inputs];
      const { dropped, output } = stcsMergePlan(...((): [SSTable[], SSTable[]] => {
        const files = compactionJobFiles(job, s);
        return [files.inputs, files.others];
      })());
      const keptTombstones = output.filter((e) => e.tombstone === true).length;
      const droppedTombstones = dropped.filter((e) => e.tombstone === true).length;
      const { state: next, newFile } = completeCompactionJob(s, job);
      s = next;
      const highlights: Highlight[] = [
        ...inputIds.map((id) => ({ id, role: "removed" as const })),
        ...dropped.map((e) => ({
          id: e.id,
          role: e.tombstone === true ? ("removed" as const) : ("stale" as const),
        })),
      ];
      if (newFile) highlights.unshift({ id: newFile.id, role: "new" });
      const tombstoneNote =
        droppedTombstones > 0 && keptTombstones > 0
          ? `${droppedTombstones} tombstone(s) were dropped because nothing older outside the merge can hold their keys, while ${keptTombstones} survived because an older file still might.`
          : droppedTombstones > 0
            ? `${droppedTombstones} tombstone(s) were dropped: nothing older outside the merge can hold their keys.`
            : keptTombstones > 0
              ? `${keptTombstones} tombstone(s) survived because an older file outside the merge could still hold their key.`
              : "";
      steps.push(
        step(
          "compact.complete",
          s,
          newFile
            ? tombstoneNote
              ? `The merge finished: ${inputIds.length} input files collapsed into one new SSTable, so reads now probe one file instead of ${inputIds.length}. ${tombstoneNote}`
              : `The merge finished: ${inputIds.length} input files collapsed into one new SSTable, and stale versions dropped out of the stream. Reads now probe one file instead of ${inputIds.length}.`
            : `The merge finished: every surviving key was a tombstone that GC could drop, so all ${inputIds.length} input files were consumed and nothing was written back.`,
          tombstoneNote
            ? "A tombstone can leave the tree only when the merge proves nothing older can hold its key — drop one too early and the deleted value resurrects."
            : "One merged run replaces N overlapping ones, so read amplification drops — that is the payoff of compaction.",
          highlights,
        ),
      );
    }
  }

  // 4. compact.start / compact.none — the size-tiered trigger.
  const inFlight = s.jobs.some((j) => j.kind === "compaction");
  if (!inFlight) {
    const bucket = pickStcsBucket(s.l0, cfg.stcsMinThreshold);
    if (bucket) {
      const inputIds = bucket.map((f) => f.id);
      s = startCompactionJob(s, bucket, stampFloor);
      const job = s.jobs[s.jobs.length - 1]; // the job just appended
      steps.push(
        step(
          "compact.start",
          s,
          `L0 holds ${bucket.length} similar-size files — a size bucket at or past stcsMinThreshold (${cfg.stcsMinThreshold}) — so they merge into ONE new SSTable. During the merge the old files stay on disk beside the output, so disk use can transiently reach ~2x the bucket's size.`,
          "Size-tiered compaction batches equal-size runs into one bigger run, trading transient space for fewer, longer merges.",
          [
            ...inputIds.map((id) => ({ id, role: "active" as const })),
            { id: job.id, role: "new" as const },
          ],
        ),
      );
    } else if (steps.length === 0) {
      steps.push(
        step(
          "compact.none",
          s,
          `No size bucket has reached stcsMinThreshold (${cfg.stcsMinThreshold}) files yet — nothing to merge. Size-tiered compaction waits until enough similar-size files pile up to make one merge worthwhile.`,
          "Merging too eagerly burns I/O for little gain; STCS batches by size class.",
        ),
      );
    }
  }

  // 5. compact.stall — compaction debt slows down writes.
  const compactionInFlight = s.jobs.some((j) => j.kind === "compaction");
  if (s.l0.length >= cfg.l0Trigger && compactionInFlight) {
    steps.push(
      step(
        "compact.stall",
        s,
        `L0 is at the l0Trigger threshold (${cfg.l0Trigger} files) while a compaction job is still in flight — new flushes would have to wait. Compaction debt: when merges can't keep up with writes, the write path stalls.`,
        "Writes never block on their own flush, but they do block when L0 fills faster than compaction drains it.",
        s.l0.map((f) => ({ id: f.id, role: "active" as const })),
      ),
    );
  }

  return { steps, result: s };
}
