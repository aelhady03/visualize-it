/**
 * Deterministic k-way merge of sorted Entry runs — the heart of flush and
 * compaction (PLAN.md §5.2 Read / Compact).
 *
 * Rules:
 * - Output is sorted by key (lexicographic string compare, see derive.ts).
 * - On duplicate keys the HIGHEST-seq entry wins. This is the critical
 *   max-seq reconciliation: file order, run order, and each run's own max
 *   seq must NEVER decide which value survives — only `seq` does.
 * - When the winner is a tombstone, the `keepTombstone` policy decides
 *   whether it survives into the output (the hook for the compaction
 *   tombstone-GC rule, PLAN.md §5.2 Delete). If the policy drops it, the
 *   whole key is dropped: every other copy of the key in the inputs is
 *   older, and a tombstone shadows everything older.
 * - Deterministic: no randomness, no reliance on iteration order of maps.
 */

import type { Entry } from "../state";
import { compareKeys } from "./derive";

/**
 * Tombstone policy hook. Receives the winning (highest-seq) tombstone and
 * EVERY entry with that key found across all input runs, and returns
 * whether the tombstone survives the merge. The later compaction lane will
 * pass a policy implementing the GC rule (only drop when no older data for
 * the key can exist outside the merge's inputs).
 *
 * Note for composition: mergeRuns(runs) is NOT always equal to folding
 * mergeRuns pairwise when the policy inspects `allEntriesForKey` — a
 * pairwise fold hands the policy partial groups. Stateless policies
 * (deciding on the winning entry alone) compose perfectly; group-aware
 * policies should be applied to the whole merge at once.
 */
export type KeepTombstone = (entry: Entry, allEntriesForKey: Entry[]) => boolean;

/** Default policy: never drop a tombstone (safe, and the pre-compaction rule). */
export const keepAllTombstones: KeepTombstone = () => true;

/**
 * k-way merge. `runs` must each be sorted by key (non-decreasing); keys may
 * repeat ACROSS runs (that is the normal case).
 *
 * Complexity: O(total entries × runs) — a naive scan over the k run heads
 * instead of a heap. Deliberate: k is tiny in this teaching engine (≤ 4-ish
 * files) and the scan is easier to narrate. Documented so nobody "optimizes"
 * it into a heap for the demo.
 *
 * Equal-seq duplicates for the same key are invalid input (seqs are globally
 * unique by the engine's logical clock). They cannot be reconciled, so the
 * first-seen entry (lower run index) wins — deterministic, never value- or
 * order-of-arrival-dependent beyond run order itself.
 */
export function mergeRuns(
  runs: Entry[][],
  keepTombstone: KeepTombstone = keepAllTombstones,
): Entry[] {
  const out: Entry[] = [];
  const head = runs.map(() => 0); // next index per run

  const peekKey = (r: number): string | null =>
    head[r] < runs[r].length ? runs[r][head[r]].key : null;

  for (;;) {
    // 1. Find the smallest current key across the run heads.
    let minKey: string | null = null;
    for (let r = 0; r < runs.length; r++) {
      const k = peekKey(r);
      if (k !== null && (minKey === null || compareKeys(k, minKey) < 0)) minKey = k;
    }
    if (minKey === null) break; // all runs exhausted

    // 2. Pull EVERY entry with that key from every run (the key's group).
    const group: Entry[] = [];
    for (let r = 0; r < runs.length; r++) {
      while (head[r] < runs[r].length && runs[r][head[r]].key === minKey) {
        group.push(runs[r][head[r]]);
        head[r]++;
      }
    }

    // 3. Highest seq wins — never file order, never run order.
    let winner = group[0];
    for (let i = 1; i < group.length; i++) {
      if (group[i].seq > winner.seq) winner = group[i];
    }

    // 4. Tombstone policy gate.
    if (winner.tombstone === true) {
      if (keepTombstone(winner, group)) out.push(winner);
      // else: dropped — the key vanishes from the output entirely.
    } else {
      out.push(winner);
    }
  }
  return out;
}

/** Convenience: pairwise merge, same rules as the k-way. */
export function mergePair(
  a: Entry[],
  b: Entry[],
  keepTombstone: KeepTombstone = keepAllTombstones,
): Entry[] {
  return mergeRuns([a, b], keepTombstone);
}
