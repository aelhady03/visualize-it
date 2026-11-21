/**
 * The read operation (PLAN.md §5.2 Read) — the READ lane's implementation.
 *
 * Probe order, newest data first:
 *   1. read.memtable-active    — the active MemTable. A hit here is final:
 *                                memtables always hold newer data than any
 *                                SSTable (entries move memtable → file in
 *                                seq order), so nothing can shadow it.
 *   2. read.memtable-immutable — immutable MemTables, newest first (the array
 *                                is freeze order, newest first). A hit is
 *                                final for the same reason.
 *   3. read.l0                 — one step per L0 file actually opened. stcs:
 *                                every file lives in l0 as an UNORDERED sorted
 *                                run, so candidates are probed in DESCENDING
 *                                max seq; leveled: newest → oldest (the array
 *                                is oldest-first, so it is walked in reverse).
 *   4. read.level              — leveled only: binary search over each level's
 *                                disjoint file ranges → at most ONE candidate
 *                                file per level (that bound is the
 *                                read-amplification win).
 *   5. read.done / read.tombstone / read.bloom-false-positive — outcomes.
 *
 * Per file the probe is: range check ([minKey, maxKey] are DERIVED from the
 * blocks) → bloom filter → sparse-index binary search → block scan. A bloom
 * "definitely not" skips the file without touching a block; a bloom "maybe"
 * whose scan finds nothing is a FALSE POSITIVE (deliberately common in the
 * 16-bit teaching filter, lib/bloom.ts) and the read keeps going.
 *
 * Reconciliation (the R1 fix, PLAN.md §5.2 step 5): a hit is NOT automatically
 * final. The walk keeps probing while the next candidate file's max seq is
 * still above the hit's seq, and the hit with the HIGHEST seq overall wins.
 * Once the next candidate's max seq ≤ the winner's seq, no remaining file can
 * hold a newer version, so the walk stops — that is also what bounds the
 * files probed. The same rule covers tombstones: a tombstone hit only ends
 * the read once nothing newer can shadow it (a delete followed by a newer
 * write must return the newer write). When the final winner IS a tombstone,
 * the read reports "not found" and stops — it shadows everything older.
 *
 * Reads do NOT advance background jobs: PLAN.md §5.2 Read enumerates no jobs
 * step, and the freeze/flush job model (§5.1) makes the immutable-MemTable
 * probe observable without reads mutating the write pipeline.
 *
 * metrics.lastReadFiles / lastReadBlocks reset at the start of every read and
 * count the files whose bloom filter was consulted (range check passed) and
 * the data blocks scanned. The final step carries a machine-readable outcome
 * in Step.extras ({ key, found, seq?, value?, tombstone, filesProbed,
 * blocksProbed }) for tests and tooling — never narration wording.
 *
 * Pure: imports only @core/engine-contract and this module's pure files
 * (state.ts, lib/**). Deterministic: no randomness, no clocks, no mutation of
 * the input state.
 *
 * EXACT export signature the registry (engine/index.ts) requires — keep it:
 *   export function runRead(state: EngineState, input: OpInput | undefined): RunResult<EngineState>
 */

import type { Highlight, OpInput, RunResult, Step } from "@core/engine-contract";
import type { Block, CompactionStrategy, EngineState, Entry, SSTable } from "../state";
import { resolveConfig } from "../lib/config";
import { maybe } from "../lib/bloom";
import { sparseIndex, sstableMaxKey, sstableMinKey } from "../lib/derive";

/**
 * Highlight-id prefix that carries the read key into the render regions: the
 * read op emits `{ id: "readkey:<key>", role: "active" }` on every step, and
 * render/BloomView.tsx reads it back (the region receives highlights only —
 * RenderProps carries no op input). Same constant, duplicated by design in
 * that file: engine/** is pure and may not import render/**.
 */
const READKEY_PREFIX = "readkey:";

/** First entry with this key in a sorted entries array, or null. */
function findByKey(entries: Entry[], key: string): Entry | null {
  return entries.find((e) => e.key === key) ?? null;
}

/**
 * Sparse-index binary search: the last block whose first key is ≤ the key.
 * With a passed range check the first block always qualifies, so this only
 * returns null on degenerate (empty) files.
 */
function blockByIndex(file: SSTable, key: string): Block | null {
  const index = sparseIndex(file.blocks);
  let lo = 0;
  let hi = index.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid].key <= key) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return null;
  return file.blocks.find((b) => b.id === index[found].blockId) ?? null;
}

/** One candidate file in the walk, tagged with its step kind. */
interface FileCandidate {
  file: SSTable;
  kind: "read.l0" | "read.level";
}

/**
 * At most one candidate file per (leveled) level: the last file whose first
 * key is ≤ the key, kept only when its maxKey also covers it. Levels hold
 * disjoint ranges sorted by key, so this binary search is the whole level
 * walk — the read-amplification win PLAN.md §5.2 names.
 */
function candidateInLevel(level: SSTable[], key: string): SSTable | null {
  let lo = 0;
  let hi = level.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const minKey = sstableMinKey(level[mid]);
    if (minKey !== null && minKey <= key) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return null;
  const file = level[found];
  const maxKey = sstableMaxKey(file);
  return maxKey !== null && key <= maxKey ? file : null;
}

/**
 * The file walk order (after the memtables):
 * - leveled: L0 newest → oldest (reverse of the oldest-first array), then one
 *   binary-search candidate per level, L1 → Ln.
 * - stcs: every l0 file as an unordered sorted run, in DESCENDING max seq
 *   (stable sort — ties keep flush order, so the order stays deterministic).
 */
function orderedFileCandidates(
  state: EngineState,
  key: string,
  strategy: CompactionStrategy,
): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  if (strategy === "leveled") {
    for (let i = state.l0.length - 1; i >= 0; i--) {
      candidates.push({ file: state.l0[i], kind: "read.l0" });
    }
    for (const level of state.levels) {
      const file = candidateInLevel(level, key);
      if (file !== null) candidates.push({ file, kind: "read.level" });
    }
  } else {
    const byNewest = [...state.l0].sort((a, b) => b.seq - a.seq);
    for (const file of byNewest) candidates.push({ file, kind: "read.l0" });
  }
  return candidates;
}

export function runRead(state: EngineState, input: OpInput | undefined): RunResult<EngineState> {
  const key = input?.key;
  if (typeof key !== "string" || key.length === 0) {
    // Contract: `error` is for INVALID INPUT ONLY. A read that finds nothing
    // is a normal, step-emitting operation — not an error.
    return { steps: [], result: state, error: "invalid input: key must be a non-empty string" };
  }

  const cfg = resolveConfig(state.config);
  const steps: Step<EngineState>[] = [];
  let filesProbed = 0;
  let blocksProbed = 0;
  let best: Entry | null = null;
  let bestFile: SSTable | null = null;

  // The running snapshot: every step state is a full EngineState. Only the
  // metrics move between read steps, so the counters accumulate visibly
  // across the file walk.
  let current: EngineState = {
    ...state,
    metrics: { ...state.metrics, lastReadFiles: 0, lastReadBlocks: 0 },
  };
  const snapshot = (): EngineState => {
    current = {
      ...current,
      metrics: { ...current.metrics, lastReadFiles: filesProbed, lastReadBlocks: blocksProbed },
    };
    return current;
  };
  const push = (
    kind: string,
    narration: string,
    why: string | undefined,
    highlights: Highlight[],
    extras?: Record<string, unknown>,
  ): void => {
    steps.push({ kind, state: snapshot(), narration, why, highlights, extras });
  };
  const readkeyHl = (): Highlight => ({ id: `${READKEY_PREFIX}${key}`, role: "active" });

  /**
   * Emit the outcome step and close the run. `winner` is the highest-seq hit
   * (a tombstone reports "not found"), `winnerFile` the file that held it.
   */
  const finish = (winner: Entry | null, winnerFile: SSTable | null): RunResult<EngineState> => {
    const outcome: Record<string, unknown> = {
      key,
      found: winner !== null && winner.tombstone !== true,
      tombstone: winner?.tombstone === true,
      filesProbed,
      blocksProbed,
    };
    if (winner !== null) {
      outcome.seq = winner.seq;
      if (winner.tombstone !== true) outcome.value = winner.value;
    }

    if (winner !== null && winner.tombstone === true) {
      push(
        "read.tombstone",
        `The newest version of "${key}" is a tombstone — the key was deleted. The read reports "not found" and stops: a tombstone shadows every older copy.`,
        "Deletes write a marker through the normal path; the old values survive in older files but stay hidden behind the tombstone.",
        [
          readkeyHl(),
          { id: winner.id, role: "hit" },
          ...(winnerFile !== null ? [{ id: winnerFile.id, role: "hit" as const }] : []),
        ],
        outcome,
      );
      return { steps, result: current };
    }

    if (winner !== null) {
      push(
        "read.done",
        `Read complete: "${key}" = "${winner.value}" (seq ${winner.seq}) — the highest-seq version — after probing ${filesProbed} file(s) and ${blocksProbed} block(s).`,
        "Read amplification counts the files and blocks one read touches — that is the number compaction keeps bounded.",
        [
          readkeyHl(),
          { id: winner.id, role: "hit" },
          ...(winnerFile !== null ? [{ id: winnerFile.id, role: "hit" as const }] : []),
        ],
        outcome,
      );
      return { steps, result: current };
    }

    push(
      "read.done",
      `Read complete: "${key}" is not in the tree. The search probed ${filesProbed} file(s) and ${blocksProbed} block(s).`,
      "Every file whose bloom filter answered “maybe” had to be confirmed with an index search and a block scan.",
      [readkeyHl()],
      outcome,
    );
    return { steps, result: current };
  };

  // 1. read.memtable-active — the newest data lives in memory.
  const active = current.memtables.find((m) => m.state === "active");
  if (active !== undefined) {
    const hit = findByKey(active.entries, key);
    if (hit !== null) {
      push(
        "read.memtable-active",
        `"${key}" is in the active MemTable — the newest version by construction, since every write lands in memory first. The read stops here.`,
        "Reads start at the newest data and stop at the first hit: memtables always sit above the SSTables.",
        [
          readkeyHl(),
          { id: active.id, role: "hit" },
          { id: hit.id, role: "hit" },
        ],
      );
      return finish(hit, null);
    }
    push(
      "read.memtable-active",
      `The active MemTable has no "${key}" — the read moves on to older data.`,
      "The MemTable is only the newest layer: a miss here means the key, if it exists at all, lives in the frozen tables or the files below.",
      [readkeyHl(), { id: active.id, role: "miss" }],
    );
  }

  // 2. read.memtable-immutable — frozen tables stay readable during a flush.
  for (const mt of current.memtables) {
    if (mt.state !== "immutable") continue;
    const hit = findByKey(mt.entries, key);
    if (hit !== null) {
      push(
        "read.memtable-immutable",
        `"${key}" lives in an immutable MemTable that is still being flushed. The frozen table stays readable until its background flush finishes — and this hit is final, because files only hold older data.`,
        "A freeze queues a flush instead of blocking writes; reads can still see the frozen table for as long as the job runs.",
        [
          readkeyHl(),
          { id: mt.id, role: "hit" },
          { id: hit.id, role: "hit" },
        ],
      );
      return finish(hit, null);
    }
    push(
      "read.memtable-immutable",
      `The immutable MemTable ${mt.id} holds no "${key}" either.`,
      "Frozen tables stay readable during a flush; a miss there sends the read down to the files on disk.",
      [readkeyHl(), { id: mt.id, role: "miss" }],
    );
  }

  // 3–5. The file walk: newest candidates first, R1 max-seq reconciliation.
  for (const candidate of orderedFileCandidates(current, key, cfg.strategy)) {
    // R1: once the next candidate's max seq cannot beat the winner, no
    // remaining file can hold a newer version — stop probing.
    if (best !== null && candidate.file.seq <= best.seq) break;

    const minKey = sstableMinKey(candidate.file);
    const maxKey = sstableMaxKey(candidate.file);
    if (minKey === null || maxKey === null) continue; // degenerate empty file
    if (key < minKey || key > maxKey) continue; // range miss: the file cannot hold the key

    filesProbed += 1;

    // Bloom filter: a "definitely not" is always true — skip for free.
    if (!maybe(candidate.file.bloom, key)) {
      push(
        candidate.kind,
        `File ${candidate.file.id} is skipped: its bloom filter answers "definitely not" for "${key}". One bit check replaces reading the file's index and blocks.`,
        "A bloom filter has no false negatives, so a “no” is always true — the file can be skipped without touching a block.",
        [readkeyHl(), { id: candidate.file.id, role: "miss" }],
      );
      continue;
    }

    // Sparse-index binary search → at most one block to scan.
    const block = blockByIndex(candidate.file, key);
    if (block === null) {
      // Range passed but no block qualifies — a degenerate file.
      push(
        "read.bloom-false-positive",
        `File ${candidate.file.id}'s bloom filter said "maybe" for "${key}", but no block covers it — a false positive. The read keeps probing the next file.`,
        "False positives are the price of a tiny filter: a “maybe” must always be confirmed against the index and a real block scan.",
        [readkeyHl(), { id: candidate.file.id, role: "miss" }],
      );
      continue;
    }
    blocksProbed += 1;
    const hit = findByKey(block.entries, key);
    if (hit === null) {
      push(
        "read.bloom-false-positive",
        `The bloom filter of ${candidate.file.id} said "maybe", the sparse index pointed at block ${block.id}, but the scan found no "${key}" — a false positive (common on purpose in a 16-bit filter). The read keeps probing the next file.`,
        "False positives are the price of a tiny filter: “maybe” must always be confirmed by the index and a real block scan.",
        [
          readkeyHl(),
          { id: candidate.file.id, role: "miss" },
          { id: block.id, role: "miss" },
        ],
      );
      continue;
    }

    if (best === null || hit.seq > best.seq) {
      if (hit.tombstone === true) {
        push(
          candidate.kind,
          `"${key}" found in ${candidate.file.id}: the range matched, the bloom filter said "maybe", and the scan confirmed a tombstone at seq ${hit.seq} — the key was deleted here. The read keeps probing while a newer file could still shadow it.`,
          "Deletes are writes of a marker; whether the marker wins is decided by seq, exactly like any version.",
          [
            readkeyHl(),
            { id: candidate.file.id, role: "hit" },
            { id: block.id, role: "hit" },
            { id: hit.id, role: "hit" },
          ],
        );
      } else if (best !== null) {
        push(
          candidate.kind,
          `A NEWER "${key}" (seq ${hit.seq}) turned up in ${candidate.file.id}, replacing the seq-${best.seq} version found earlier. The read keeps probing while a newer file can still shadow it.`,
          "Sequence numbers, not file order, decide which version wins.",
          [
            readkeyHl(),
            { id: candidate.file.id, role: "hit" },
            { id: block.id, role: "hit" },
            { id: hit.id, role: "hit" },
            { id: best.id, role: "stale" },
          ],
        );
      } else {
        push(
          candidate.kind,
          `"${key}" found in ${candidate.file.id}: the range matched, the bloom filter said "maybe", the sparse index pointed at block ${block.id}, and the scan confirmed "${hit.value}" at seq ${hit.seq}.`,
          "One index row per block plus a binary search keeps the scan to a single block.",
          [
            readkeyHl(),
            { id: candidate.file.id, role: "hit" },
            { id: block.id, role: "hit" },
            { id: hit.id, role: "hit" },
          ],
        );
      }
      best = hit;
      bestFile = candidate.file;
    } else {
      push(
        candidate.kind,
        `"${key}" also appears in ${candidate.file.id} — but its seq ${hit.seq} is older than the winner found so far (seq ${best.seq}), so it is ignored.`,
        "Only the highest sequence number wins; the older copy stays in its file until compaction.",
        [
          readkeyHl(),
          { id: candidate.file.id, role: "hit" },
          { id: block.id, role: "hit" },
          { id: hit.id, role: "stale" },
        ],
      );
    }
  }

  return finish(best, bestFile);
}
