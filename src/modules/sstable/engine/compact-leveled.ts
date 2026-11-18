/**
 * Leveled compaction (PLAN.md §5.2 Compact — leveled) — the engine half of
 * the LEVELED lane.
 *
 * Strategy shape:
 * - L0 holds OVERLAPPING-range files, ordered by age (oldest first).
 * - L1+ (state.levels[i], index 0 = L1) hold single sorted runs split into
 *   DISJOINT-range files; every output file is split at `targetFileSize`
 *   bytes, and each level's total budget grows ~`fanout` per level:
 *   `levelTargetBytes(n) = targetFileSize × fanout^n` (n is 1-based, so L1's
 *   budget is ~fanout flushes).
 *
 * Pick policy (documented — deterministic, no randomness):
 * 1. L0 spill: when `l0.length >= l0Trigger`, take the OLDEST L0 file plus
 *    every L0 file whose range overlaps the growing union (fixpoint — L0
 *    ranges overlap transitively), and also every L1 file overlapping that
 *    union, so L1 stays disjoint after the output lands.
 * 2. Otherwise the SHALLOWEST level whose total bytes exceed its budget is
 *    picked: ONE file from it (size score — the largest by `bytes`, first
 *    wins ties) merged with ALL files of the next level whose ranges overlap
 *    it (fixpoint on the union). Output lands one level down (created if
 *    needed).
 * 3. Otherwise nothing needs compaction → `compact.idle`.
 *
 * Tombstone GC rule (PLAN.md §5.2 Delete): a tombstone survives the merge
 * only when the OUTPUT level is not the bottommost AND some lower level has
 * a file whose range covers the key — otherwise the key vanishes for good.
 *
 * Jobs model: one `compact` op advances jobs one unit (`advanceJobs`);
 * a compaction needs `inputs.length` units and its renderable `output` grows
 * like the flush stream (first `blockSize × progress` entries of the full
 * merge). Ids come from the logical clock (`seq`), which the compaction
 * advances when minting job and output-file ids — so two compactions can
 * never mint the same id.
 *
 * Step kinds (all `compact.`-prefixed):
 *   compact.pick · compact.merge · compact.complete · compact.idle ·
 *   compact.stall (write-stall narration: l0 >= l0Trigger while a compaction
 *   job is in flight).
 *
 * EXACT export signature (engine/compact.ts dispatches to it):
 *   export function runCompactLeveled(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { Highlight, OpInput, RunResult, Step } from "@core/engine-contract";
import type { EngineState, Entry, Job, SSTable } from "../state";
import { entryBytes, sstableEntries, sstableMaxKey, sstableMinKey } from "../lib/derive";
import { mergeRuns, type KeepTombstone } from "../lib/merge";
import { resolveConfig } from "../lib/config";
import { advanceJobs, buildSSTable } from "./jobs";

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
// Pure helpers
// ---------------------------------------------------------------------------

/** Every SSTable in state, l0 first then levels shallow→deep. */
function allFiles(state: EngineState): SSTable[] {
  return [...state.l0, ...state.levels.flat()];
}

function rangeOf(sst: SSTable): { min: string; max: string } | null {
  const min = sstableMinKey(sst);
  const max = sstableMaxKey(sst);
  return min === null || max === null ? null : { min, max };
}

/** Inclusive key-range coverage check (a range "covers" a key). */
function coversKey(sst: SSTable, key: string): boolean {
  const range = rangeOf(sst);
  return range !== null && range.min <= key && key <= range.max;
}

/** Inclusive range overlap between a file and a growing union range. */
function overlapsUnion(sst: SSTable, union: { min: string; max: string }): boolean {
  const range = rangeOf(sst);
  return range !== null && range.min <= union.max && union.min <= range.max;
}

function expandUnion(
  union: { min: string; max: string },
  range: { min: string; max: string },
): { min: string; max: string } {
  return { min: range.min < union.min ? range.min : union.min, max: range.max > union.max ? range.max : union.max };
}

/** L(n)'s total-size budget: targetFileSize × fanout^n (n is 1-based). */
export function levelTargetBytes(cfg: { targetFileSize: number; fanout: number }, n: number): number {
  return cfg.targetFileSize * Math.pow(cfg.fanout, n);
}

/** The plan for one compaction: the input file ids and where the output lands. */
interface CompactionPlan {
  /** SSTable ids, merge-run order. */
  inputs: string[];
  /** 1-based output level (1 = state.levels[0]). */
  outputLevel: number;
  /** The picked level, for narration ("L0" or "L2"). */
  source: string;
  /** The level whose oversize triggered the pick, when not an L0 spill. */
  oversizedLevel?: number;
  /** The score-picked file, when not an L0 spill. */
  scoredFile?: string;
}

/**
 * Pick the next compaction (documented policy at the top of this file).
 * Deterministic: age order for L0, byte size for levels, no randomness.
 */
function pickCompaction(
  state: EngineState,
  cfg: { targetFileSize: number; fanout: number; l0Trigger: number },
): CompactionPlan | null {
  // 1. L0 spill (the oldest non-empty L0 file seeds the overlap group).
  if (state.l0.length >= cfg.l0Trigger) {
    const seed = state.l0.find((sst) => rangeOf(sst) !== null);
    if (seed) {
      const inputs: string[] = [seed.id];
      let union = rangeOf(seed)!;
      for (const candidatePool of [state.l0, state.levels[0] ?? []]) {
        let changed = true;
        while (changed) {
          changed = false;
          for (const sst of candidatePool) {
            if (inputs.includes(sst.id)) continue;
            if (overlapsUnion(sst, union)) {
              inputs.push(sst.id);
              union = expandUnion(union, rangeOf(sst)!);
              changed = true;
            }
          }
        }
      }
      return { inputs, outputLevel: 1, source: "L0" };
    }
  }

  // 2. Shallowest level over its budget: pick ONE file by size score.
  for (let n = 1; n <= state.levels.length; n++) {
    const level = state.levels[n - 1];
    const total = level.reduce((sum, sst) => sum + sst.bytes, 0);
    if (total <= levelTargetBytes(cfg, n)) continue;
    let chosen: SSTable | null = null;
    for (const sst of level) {
      if (chosen === null || sst.bytes > chosen.bytes) chosen = sst;
    }
    if (chosen === null || rangeOf(chosen) === null) continue;
    const inputs = [chosen.id];
    let union = rangeOf(chosen)!;
    const next = state.levels[n] ?? [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const sst of next) {
        if (inputs.includes(sst.id)) continue;
        if (overlapsUnion(sst, union)) {
          inputs.push(sst.id);
          union = expandUnion(union, rangeOf(sst)!);
          changed = true;
        }
      }
    }
    return {
      inputs,
      outputLevel: n + 1,
      source: `L${n}`,
      oversizedLevel: n,
      scoredFile: chosen.id,
    };
  }

  return null;
}

/**
 * The output level of a compaction job, derived from where its inputs live:
 * the shallowest input level + 1 (L0 inputs → L1). Deriving keeps the Job
 * shape JSON-only — nothing extra is stored on the job.
 */
function outputLevelFor(state: EngineState, inputs: string[]): number {
  const l0Ids = new Set(state.l0.map((sst) => sst.id));
  if (inputs.some((id) => l0Ids.has(id))) return 1;
  let shallowest = Number.POSITIVE_INFINITY;
  for (const id of inputs) {
    for (let i = 0; i < state.levels.length; i++) {
      if (state.levels[i].some((sst) => sst.id === id)) {
        shallowest = Math.min(shallowest, i + 1);
        break;
      }
    }
  }
  return Number.isFinite(shallowest) ? shallowest + 1 : 1;
}

/**
 * The leveled tombstone-GC policy for one merge (PLAN.md §5.2 Delete): keep
 * a tombstone ONLY when the output level is not the bottommost and some
 * lower level still has a file whose range covers the key. Dropping means
 * the whole key leaves the output — everything older in the inputs dies with
 * it, which is exactly what the rule must prevent when older data could
 * still hide below.
 */
function leveledKeepTombstone(state: EngineState, outputLevel: number): KeepTombstone {
  const lowerLevels = state.levels.slice(outputLevel); // levels deeper than the output
  return (winner) => {
    if (lowerLevels.length === 0) return false; // bottommost: nothing below can resurrect
    return lowerLevels.some((level) => level.some((sst) => coversKey(sst, winner.key)));
  };
}

/** The full merged entry stream for a compaction job's inputs. */
function mergeJobInputs(state: EngineState, job: Job, outputLevel: number): Entry[] {
  const runs: Entry[][] = [];
  const files = allFiles(state);
  for (const id of job.inputs) {
    const sst = files.find((f) => f.id === id);
    if (sst) runs.push(sstableEntries(sst));
  }
  return mergeRuns(runs, leveledKeepTombstone(state, outputLevel));
}

/**
 * Split merged entries into output files of at most `targetFileSize` bytes
 * (greedy; a single entry larger than the target still gets its own file).
 */
function splitAtBytes(entries: Entry[], targetFileSize: number): Entry[][] {
  const chunks: Entry[][] = [];
  let current: Entry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = entryBytes(entry);
    if (current.length > 0 && bytes + size > targetFileSize) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Create the compaction job (progress 0) and consume one logical-clock stamp. */
function createJob(state: EngineState, plan: CompactionPlan): EngineState {
  const job: Job = {
    id: `j${state.seq}`,
    kind: "compaction",
    inputs: plan.inputs,
    output: [],
    progress: 0,
    total: plan.inputs.length,
  };
  return { ...state, seq: state.seq + 1, jobs: [...state.jobs, job] };
}

/**
 * Grow every in-flight compaction job's renderable `output` to the first
 * `blockSize × progress` entries of its full merge (the full stream at
 * completion). jobs.ts only grows flush streams, so this is the compaction
 * half of the same convention.
 */
function growCompactionOutputs(state: EngineState): EngineState {
  const cfg = resolveConfig(state.config);
  const jobs = state.jobs.map((job) => {
    if (job.kind !== "compaction") return job;
    const merged = mergeJobInputs(state, job, outputLevelFor(state, job.inputs));
    const output = job.progress >= job.total ? merged : merged.slice(0, cfg.blockSize * job.progress);
    return { ...job, output };
  });
  return { ...state, jobs };
}

interface CompactionCompletion {
  state: EngineState;
  outputs: SSTable[];
  outputLevel: number;
  keptTombstones: number;
  droppedTombstones: number;
}

/**
 * Complete a compaction: merge the inputs (GC policy applied), split the
 * stream at `targetFileSize`, land the outputs in the target level (sorted
 * by range), remove the inputs, and settle the metrics (bytesWritten grows
 * by the output bytes; diskBytes by the net change).
 */
function completeCompaction(state: EngineState, job: Job): CompactionCompletion {
  const cfg = resolveConfig(state.config);
  const outputLevel = outputLevelFor(state, job.inputs);
  const merged = mergeJobInputs(state, job, outputLevel);

  const inputSet = new Set(job.inputs);
  const files = allFiles(state);
  const inBytes = files.filter((f) => inputSet.has(f.id)).reduce((sum, f) => sum + f.bytes, 0);
  const tombstoneKeys = new Set(
    files
      .filter((f) => inputSet.has(f.id))
      .flatMap((f) => sstableEntries(f))
      .filter((e) => e.tombstone === true)
      .map((e) => e.key),
  );

  const stamp = state.seq;
  const outputs = splitAtBytes(merged, cfg.targetFileSize).map((entries, i) =>
    buildSSTable(`c${stamp}-${i + 1}`, entries, cfg.blockSize),
  );
  const outBytes = outputs.reduce((sum, f) => sum + f.bytes, 0);

  const keptTombstones = merged.filter((e) => e.tombstone === true).length;
  // Dropped = the key left the stream entirely (true GC). A tombstone that
  // lost to a NEWER value is just another stale version, not a GC decision.
  const droppedTombstones = [...tombstoneKeys].filter((key) => !merged.some((e) => e.key === key))
    .length;

  const l0 = state.l0.filter((f) => !inputSet.has(f.id));
  const levels = state.levels.map((level) => level.filter((f) => !inputSet.has(f.id)));
  while (levels.length < outputLevel) levels.push([]);
  levels[outputLevel - 1] = [...levels[outputLevel - 1], ...outputs].sort((a, b) => {
    const aMin = sstableMinKey(a) ?? "";
    const bMin = sstableMinKey(b) ?? "";
    return aMin < bMin ? -1 : aMin > bMin ? 1 : 0;
  });
  while (levels.length > 0 && levels[levels.length - 1].length === 0) levels.pop();

  return {
    state: {
      ...state,
      seq: stamp + 1,
      l0,
      levels,
      jobs: state.jobs.filter((j) => j.id !== job.id),
      metrics: {
        ...state.metrics,
        bytesWritten: state.metrics.bytesWritten + outBytes,
        diskBytes: state.metrics.diskBytes + outBytes - inBytes,
      },
    },
    outputs,
    outputLevel,
    keptTombstones,
    droppedTombstones,
  };
}

// ---------------------------------------------------------------------------
// The operation
// ---------------------------------------------------------------------------

/**
 * One `compact` op under the leveled strategy:
 * 1. If a compaction job is in flight, advance it one unit (all jobs advance,
 *    per the jobs model) and complete it when it reaches its total.
 * 2. Otherwise pick the next compaction (L0 spill / oversized level) and
 *    start its job — including the first unit of merge progress.
 * 3. Narrate the write stall when L0 is at/over the trigger while a
 *    compaction job is still in flight.
 */
export function runCompactLeveled(
  state: EngineState,
  input: OpInput | undefined,
): RunResult<EngineState> {
  void input; // no-input op (bare run button) — any input is ignored
  const cfg = resolveConfig(state.config);
  const steps: Step<EngineState>[] = [];
  let s = state;

  const pending = s.jobs.find((j) => j.kind === "compaction");
  if (pending) {
    // A job is in flight: this op spends its unit on background progress.
    if (pending.progress < pending.total) {
      s = advanceJobs(s); // every job +1; finished flushes land their SSTables
      s = growCompactionOutputs(s);
      const job = s.jobs.find((j) => j.id === pending.id);
      if (job) {
        steps.push(
          step(
            "compact.merge",
            s,
            `The compaction advanced one unit (${job.progress}/${job.total}): its merge stream now holds ${job.output.length} entries, merged in key order with the highest seq winning.`,
            "One unit per operation makes background work observable without ever blocking the foreground op.",
            pending.inputs.map((id) => ({ id, role: "active" as const })),
          ),
        );
      }
    }
    const finished = s.jobs.find((j) => j.kind === "compaction" && j.progress >= j.total);
    if (finished) {
      const done = completeCompaction(s, finished);
      s = done.state;
      steps.push(
        step(
          "compact.complete",
          s,
          `The compaction finished: ${done.outputs.length} file(s) landed in L${done.outputLevel} (split at ${cfg.targetFileSize}B) and ${finished.inputs.length} input(s) were removed from disk. ${done.keptTombstones} tombstone(s) survived (a lower level still covers their key) and ${done.droppedTombstones} were garbage-collected — deleted keys can never resurrect.`,
          "Dropping stale versions and eligible tombstones is what keeps disk bytes and read probes bounded.",
          [
            ...finished.inputs.map((id) => ({ id, role: "removed" as const })),
            ...done.outputs.map((f) => ({ id: f.id, role: "new" as const })),
          ],
        ),
      );
    }
  } else {
    // No compaction in flight: pick the next one (or report there is none).
    const plan = pickCompaction(s, cfg);
    if (plan) {
      s = createJob(s, plan);
      const picked =
        plan.source === "L0"
          ? `the oldest L0 file plus every file whose range overlaps the merge group (${plan.inputs.length} input(s))`
          : `its largest file (${plan.scoredFile}) plus every overlapping file one level down (${plan.inputs.length} input(s))`;
      steps.push(
        step(
          "compact.pick",
          s,
          `${plan.source} ${plan.source === "L0" ? "is at or above the l0Trigger" : `has grown past its target size`}, so a compaction picks ${picked}. The job needs ${plan.inputs.length} unit(s) of background work.`,
          plan.source === "L0"
            ? "L0 files overlap by design, so a spill merges the whole overlapping group into one sorted run — that is how reads stop probing file after file."
            : "Picking the largest file keeps the level's rewrite work focused where the bytes are.",
          plan.inputs.map((id) => ({ id, role: "active" as const })),
        ),
      );
      s = advanceJobs(s);
      s = growCompactionOutputs(s);
      const job = s.jobs.find((j) => j.kind === "compaction");
      if (job) {
        steps.push(
          step(
            "compact.merge",
            s,
            `The merge stream took its first unit: ${job.output.length} merged entries so far, in key order with the highest seq winning.`,
            "Stale versions drop out of the stream as the merge walks the sorted runs.",
            plan.inputs.map((id) => ({ id, role: "active" as const })),
          ),
        );
      }
      const finished = s.jobs.find((j) => j.kind === "compaction" && j.progress >= j.total);
      if (finished) {
        const done = completeCompaction(s, finished);
        s = done.state;
        steps.push(
          step(
            "compact.complete",
            s,
            `The compaction finished: ${done.outputs.length} file(s) landed in L${done.outputLevel} (split at ${cfg.targetFileSize}B) and ${finished.inputs.length} input(s) were removed from disk. ${done.keptTombstones} tombstone(s) survived (a lower level still covers their key) and ${done.droppedTombstones} were garbage-collected — deleted keys can never resurrect.`,
            "Dropping stale versions and eligible tombstones is what keeps disk bytes and read probes bounded.",
            [
              ...finished.inputs.map((id) => ({ id, role: "removed" as const })),
              ...done.outputs.map((f) => ({ id: f.id, role: "new" as const })),
            ],
          ),
        );
      }
    } else {
      if (s.jobs.length > 0) {
        s = advanceJobs(s);
        s = growCompactionOutputs(s);
        steps.push(
          step(
            "compact.idle",
            s,
            "No compaction is needed right now, but the background jobs still advanced one unit while you watched.",
            "Compaction is debt-driven: it waits for overlapping files or oversized levels before it spends I/O.",
          ),
        );
      } else {
        steps.push(
          step(
            "compact.idle",
            s,
            `Nothing needs compaction right now: L0 is below its trigger and every level is within its target size.`,
            "Compaction is scheduled work — it only runs when real debt (overlaps, oversized levels) makes reads more expensive.",
          ),
        );
      }
    }
  }

  // Write-stall narration: L0 at/over the trigger while a compaction job is
  // still in flight — new flushes would have to wait for L0 space.
  if (s.l0.length >= cfg.l0Trigger && s.jobs.some((j) => j.kind === "compaction")) {
    steps.push(
      step(
        "compact.stall",
        s,
        `L0 still holds ${s.l0.length} files (at or above l0Trigger ${cfg.l0Trigger}) while a compaction is in flight — a new flush would stall right now.`,
        "Write stalls are where compaction debt becomes user-visible latency: memtable flushes wait until the merge frees L0 space.",
      ),
    );
  }

  return { steps, result: s };
}
