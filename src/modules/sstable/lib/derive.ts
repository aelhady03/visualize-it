/**
 * Pure derivations and invariant checkers over engine state (PLAN.md §8).
 *
 * Everything here is a function of state only — no mutation of inputs, no
 * I/O, no randomness. minKey/maxKey/index/liveBytes are DERIVED, never
 * stored, so they can never drift from the data.
 */

import type { Block, EngineState, Entry, SSTable } from "../state";

// ---------------------------------------------------------------------------
// Key order
// ---------------------------------------------------------------------------

/**
 * Lexicographic string compare. Uses JS `<`/`>` on strings — UTF-16 code
 * unit order — which is deterministic and matches how the engine's sorted
 * arrays are built elsewhere. Returns -1 | 0 | 1.
 */
export function compareKeys(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Simple derivations
// ---------------------------------------------------------------------------

/** All entries of an SSTable in block order (blocks are sorted → sorted). */
export function sstableEntries(sst: SSTable): Entry[] {
  const out: Entry[] = [];
  for (const block of sst.blocks) out.push(...block.entries);
  return out;
}

/** First key of an SSTable, or null when the file is empty. */
export function sstableMinKey(sst: SSTable): string | null {
  for (const block of sst.blocks) {
    if (block.entries.length > 0) return block.entries[0].key;
  }
  return null;
}

/** Last key of an SSTable, or null when the file is empty. */
export function sstableMaxKey(sst: SSTable): string | null {
  for (let i = sst.blocks.length - 1; i >= 0; i--) {
    const entries = sst.blocks[i].entries;
    if (entries.length > 0) return entries[entries.length - 1].key;
  }
  return null;
}

/** One sparse-index row per block: the block's first key (empty blocks skipped). */
export interface SparseIndexRow {
  blockId: string;
  key: string;
}

/** Sparse index over blocks — first key per block, for binary search. */
export function sparseIndex(blocks: Block[]): SparseIndexRow[] {
  const rows: SparseIndexRow[] = [];
  for (const block of blocks) {
    if (block.entries.length > 0) {
      rows.push({ blockId: block.id, key: block.entries[0].key });
    }
  }
  return rows;
}

/**
 * Byte-size estimator for one entry: key + value + id + 8 for the seq
 * counter. A teaching estimate — the engine's real `bytes`/`ingestedBytes`
 * accounting is owned by the write path, but liveBytes (derived here) and
 * the file sizes use this same estimator so amplification ratios are
 * internally consistent.
 */
export function entryBytes(entry: Entry): number {
  return entry.id.length + entry.key.length + entry.value.length + 8;
}

/**
 * liveBytes = bytes of the LIVE (latest-seq) version of every distinct key
 * across memtables and all SSTables (l0 + levels). Stale versions are
 * excluded; a tombstone counts while it is the latest version — it still
 * occupies space until compaction GCs it. WAL entries are skipped: they
 * mirror memtable entries 1:1 (§8 invariant WAL ⊇ unflushed MemTable).
 *
 * This is the denominator of space amplification (diskBytes / liveBytes).
 */
export function liveBytes(state: EngineState): number {
  const latest = new Map<string, Entry>(); // Map is internal only — state stays JSON
  const consider = (entry: Entry) => {
    const cur = latest.get(entry.key);
    if (cur === undefined || entry.seq > cur.seq) latest.set(entry.key, entry);
  };
  for (const mt of state.memtables) for (const e of mt.entries) consider(e);
  for (const sst of state.l0) for (const e of sstableEntries(sst)) consider(e);
  for (const level of state.levels) for (const sst of level) for (const e of sstableEntries(sst)) consider(e);
  let total = 0;
  for (const entry of latest.values()) total += entryBytes(entry);
  return total;
}

// ---------------------------------------------------------------------------
// Invariant checkers (PLAN.md §8)
// ---------------------------------------------------------------------------

/**
 * Sortedness: keys in non-decreasing order. Adjacent equal keys still pass —
 * duplicate detection is hasDuplicateKeysWithinFile's job, kept separate so
 * the two invariants report independently.
 */
export function isSorted(entries: Entry[]): boolean {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i - 1].key > entries[i].key) return false;
  }
  return true;
}

/** True when any key appears twice WITHIN one file (across its blocks). */
export function hasDuplicateKeysWithinFile(sst: SSTable): boolean {
  const seen = new Set<string>();
  for (const entry of sstableEntries(sst)) {
    if (seen.has(entry.key)) return true;
    seen.add(entry.key);
  }
  return false;
}

/**
 * L1+ invariant: file key ranges within a level must not overlap.
 * Ranges are inclusive [minKey, maxKey]; files that merely TOUCH at one key
 * are reported as overlapping (a shared key is a shared key). Empty files
 * have no range and are skipped.
 */
export function levelRangesDisjoint(level: SSTable[]): boolean {
  for (let i = 0; i < level.length; i++) {
    const aMin = sstableMinKey(level[i]);
    if (aMin === null) continue;
    const aMax = sstableMaxKey(level[i]) as string;
    for (let j = i + 1; j < level.length; j++) {
      const bMin = sstableMinKey(level[j]);
      if (bMin === null) continue;
      const bMax = sstableMaxKey(level[j]) as string;
      if (aMin <= bMax && bMin <= aMax) return false;
    }
  }
  return true;
}

/** One broken step in the per-key seq ordering (§8 invariant). */
export interface SeqDecreaseViolation {
  key: string;
  level: number; // shallower level index: 0 = L0, 1 = L1, ...
  seq: number; // that level's max seq for the key
  deeperLevel: number; // deeper level index holding a NOT-older copy
  deeperSeq: number; // its seq
}

/**
 * §8 invariant: per-key seq strictly decreases from L0 down through the
 * levels. For every key present in two levels, the shallower level's max seq
 * must be STRICTLY greater than the deeper level's — equal seqs violate too.
 * Returns every violating (level, deeperLevel) pair, not just a boolean, so
 * callers can point at exactly what is wrong. Levels are indexed with
 * 0 = L0, 1 = L1 (state.levels[0]), 2 = L2, ...
 *
 * MemTables are not part of the check: they sit above L0 and always hold
 * the newest writes by construction.
 */
export function seqDecreasesDownLevels(state: EngineState): SeqDecreaseViolation[] {
  const perLevel: Array<Map<string, number>> = [];
  const collect = (files: SSTable[]) => {
    const maxSeq = new Map<string, number>();
    for (const sst of files) {
      for (const entry of sstableEntries(sst)) {
        const cur = maxSeq.get(entry.key);
        if (cur === undefined || entry.seq > cur) maxSeq.set(entry.key, entry.seq);
      }
    }
    perLevel.push(maxSeq);
  };
  collect(state.l0);
  for (const level of state.levels) collect(level);

  const violations: SeqDecreaseViolation[] = [];
  for (let i = 0; i < perLevel.length - 1; i++) {
    for (let j = i + 1; j < perLevel.length; j++) {
      for (const [key, seq] of perLevel[i]) {
        const deeperSeq = perLevel[j].get(key);
        if (deeperSeq !== undefined && seq <= deeperSeq) {
          violations.push({ key, level: i, seq, deeperLevel: j, deeperSeq });
        }
      }
    }
  }
  return violations;
}
