/**
 * The update operation (PLAN.md §5.2 Update) — implemented by the
 * UPDATE/DELETE lane.
 *
 * Update is mechanically the write path; the narration is the lesson. It is
 * a BLIND write — nothing is read before writing, the key LSM advantage over
 * B-trees. SSTables are immutable, so the old value stays in its file until
 * compaction; "latest wins" is enforced by comparing seq at read time, never
 * by overwriting files.
 *
 * Two shapes, step kinds prefixed "update.":
 *  - The key is still in the ACTIVE MemTable: the entry is replaced in
 *    memory — the old version never reaches disk at all. Exactly two steps
 *    (update.wal.append + update.memtable.replace): no freeze, no flush.
 *  - Otherwise: the exact write-path mechanics, reusing the pure helpers of
 *    engine/write.ts (never edited): update.wal.append →
 *    update.memtable.insert → (update.memtable.freeze) →
 *    (update.jobs.advance → update.flush.complete) →
 *    (update.compact.trigger).
 *
 * Pure: imports only @core/engine-contract and this module's pure files.
 * Deterministic: the entry seq comes from the logical clock (state.seq);
 * no randomness, no wall clocks.
 */

import type { Highlight, OpInput, RunResult, Step } from "@core/engine-contract";
import type { EngineState, Entry } from "../state";
import { entryBytes, sstableEntries } from "../lib/derive";
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

/**
 * The newest existing version of `key` (highest seq across memtables and
 * files) — the entry this update supersedes. Used for the "stale" highlight
 * (contract: "stale" = a superseded version of an entity). The WAL is not
 * searched: it mirrors the memtables plus already-replaced records.
 */
function findStaleId(state: EngineState, key: string): string | undefined {
  let best: Entry | undefined;
  const consider = (entry: Entry) => {
    if (entry.key === key && (best === undefined || entry.seq > best.seq)) best = entry;
  };
  for (const mt of state.memtables) for (const e of mt.entries) consider(e);
  for (const sst of [...state.l0, ...state.levels.flat()]) {
    for (const e of sstableEntries(sst)) consider(e);
  }
  return best?.id;
}

export function runUpdate(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  const key = input?.key;
  if (typeof key !== "string" || key.length === 0) {
    // Contract: `error` is for INVALID INPUT ONLY (empty key, unknown op id).
    return { steps: [], result: state, error: "invalid input: key must be a non-empty string" };
  }
  const rawValue = input?.value;
  const value =
    typeof rawValue === "string" ? rawValue : rawValue === undefined ? "" : String(rawValue);

  const cfg = resolveConfig(state.config);
  const steps: Step<EngineState>[] = [];
  let next = state;

  // 1. update.wal.append — durability first; an update is a blind write.
  const seq = next.seq;
  const entry: Entry = { id: `e${seq}`, key, value, seq };
  const active = next.memtables.find((m) => m.state === "active") ?? next.memtables[0];
  next = {
    ...next,
    seq: seq + 1,
    wal: next.wal.map((w) =>
      w.id === active.walSegment ? { ...w, entries: [...w.entries, entry] } : w,
    ),
    metrics: {
      ...next.metrics,
      ingestedBytes: next.metrics.ingestedBytes + key.length + value.length,
      diskBytes: next.metrics.diskBytes + entryBytes(entry),
    },
  };
  steps.push(
    step(
      "update.wal.append",
      next,
      `The new version of "${key}" is appended to the WAL first — an update is a blind write: nothing is read beforehand, and the record is durable before the MemTable changes.`,
      "Write-ahead logging: every version reaches the log before memory, so even an update later lost to a crash has left a durable record.",
      [{ id: entry.id, role: "new" }],
    ),
  );

  // The superseded version (if any) — computed before the MemTable changes.
  const staleId = findStaleId(next, key);
  const staleHighlight: Highlight[] = staleId ? [{ id: staleId, role: "stale" }] : [];
  const keyInActive = active.entries.some((e) => e.key === key);

  if (keyInActive) {
    // In-memory replace: the old version never reaches disk at all.
    next = insertIntoActive(next, entry);
    steps.push(
      step(
        "update.memtable.replace",
        next,
        `"${key}" is still in the active MemTable, so the entry is replaced in place — the old version never reaches disk at all.`,
        "A key updated while still in memory is overwritten before a flush can ever write it to an SSTable.",
        [{ id: entry.id, role: "new" }, ...staleHighlight],
      ),
    );
    return { steps, result: next };
  }

  // 2. update.memtable.insert — the key has left the MemTable: fresh entry.
  next = insertIntoActive(next, entry);
  steps.push(
    step(
      "update.memtable.insert",
      next,
      `"${key}" is no longer in the MemTable, so the new version is written as a fresh entry — the old value stays untouched in its immutable file, and the higher seq wins at read time.`,
      "SSTables are immutable: updates never modify old files, they only stack newer versions on top.",
      [
        { id: entry.id, role: "new" },
        ...staleHighlight,
        { id: active.id, role: "active" },
      ],
    ),
  );

  // 3. update.memtable.freeze — cap reached (same mechanics as the write path).
  const nowActive = next.memtables.find((m) => m.state === "active") ?? next.memtables[0];
  if (nowActive.entries.length >= cfg.memtableCap) {
    const frozenId = nowActive.id;
    next = freezeActive(next);
    steps.push(
      step(
        "update.memtable.freeze",
        next,
        `The MemTable reached its capacity (${cfg.memtableCap} entries) and froze. A new active MemTable and a new WAL segment take over immediately, and a flush job starts in the background — updates never block on disk I/O.`,
        "Freezing converts the in-memory table into a queued background job instead of making the next update wait.",
        [
          { id: frozenId, role: "active" },
          { id: next.memtables[0].id, role: "new" },
          { id: next.wal[next.wal.length - 1].id, role: "new" },
          { id: next.jobs[next.jobs.length - 1].id, role: "new" },
        ],
      ),
    );
  }

  // 4. update.jobs.advance + 5. update.flush.complete — background jobs progress.
  if (next.jobs.length > 0) {
    next = incrementProgress(next);
    steps.push(
      step(
        "update.jobs.advance",
        next,
        "While you ran this update, background jobs made progress: every job advanced one unit toward completion.",
        "The jobs model makes flushes and compactions real and observable without stalling the write path.",
        next.jobs.flatMap((j) => j.output.map((e) => ({ id: e.id, role: "active" as const }))),
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
            "update.flush.complete",
            next,
            `The flush finished: its entries were split into blocks, indexed and bloom-filtered, and written as a new SSTable in L0. The immutable MemTable is dropped and its WAL segment is truncated — that is why the WAL stays bounded.`,
            "Once data is safely in an SSTable, the WAL segment that protected it can go. Whatever versions the file holds stay exactly as written.",
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

  // 6. update.compact.trigger — threshold met (Phase 6 builds the compaction).
  if (next.l0.length >= cfg.l0Trigger) {
    const compactionInFlight = next.jobs.some((j) => j.kind === "compaction");
    steps.push(
      step(
        "update.compact.trigger",
        next,
        compactionInFlight
          ? `L0 now holds ${next.l0.length} files — at the l0Trigger threshold (${cfg.l0Trigger}) — while a compaction is still merging. New flushes would have to wait: the update never blocked on disk I/O, but compaction debt can still slow down writes.`
          : `L0 now holds ${next.l0.length} files — at the l0Trigger threshold (${cfg.l0Trigger}). A compaction would merge them and drop the stale versions this update just left behind.`,
        compactionInFlight
          ? "Writes never block on their own flush, but they do block when L0 fills faster than compaction drains it."
          : "Compaction debt: every flush adds an L0 file a read must probe. Merging them keeps read amplification bounded.",
        next.l0.map((f) => ({ id: f.id, role: "active" as const })),
      ),
    );
  }

  return { steps, result: next };
}
