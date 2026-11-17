/**
 * Default engine configuration (PLAN.md §5.1 `EngineState.config`).
 *
 * Every value is deliberately small: this is a teaching engine, and the
 * learner should reach a flush / compaction after a handful of writes.
 */

import type { Config, SstableConfig } from "./state";

export const defaultConfig: SstableConfig = {
  /** Entries the active MemTable holds before it freezes (then a flush starts). */
  memtableCap: 6,

  /** Entries per data block — tiny so block scans and the sparse index are visible. */
  blockSize: 2,

  /** Bloom filter width in bits. 16 on purpose: false positives happen often
   *  BY DESIGN so the false-positive read path can actually be shown. */
  bloomBits: 16,

  /** Bloom filter hash count (FNV-1a 32 + djb2 32, see lib/bloom.ts). */
  bloomHashes: 2,

  /** Compaction strategy. Default "stcs" (size-tiered). */
  strategy: "stcs",

  /** L0 file count at which compaction triggers / writes stall. */
  l0Trigger: 4,

  /** STCS: files per similar-size bucket before a merge. */
  stcsMinThreshold: 4,

  /**
   * Leveled: target size growth per level. 3 is a DEMO value — real engines
   * (e.g. RocksDB's default) use ~10; at fanout 3 the level-size jump stays
   * small enough to draw.
   */
  fanout: 3,

  /**
   * Leveled: split size for L1+ output files, in bytes.
   * With blockSize 2 and ~20-byte entries, a full flush (6 entries, 3 blocks)
   * is roughly 100–130 bytes — so 128 ≈ slightly more than one flush. An
   * L0→L1 merge output still splits into visibly distinct files, while small
   * levels collapse into one. (lib/derive.ts `entryBytes` defines the byte
   * estimator this value is tuned against.)
   */
  targetFileSize: 128,
};

/**
 * The loose config bag stored in `EngineState.config` (JSON-serializable,
 * matches the `Config` contract shape). `defaultConfig` satisfies it.
 */
export function defaultEngineConfig(): Config {
  return { ...defaultConfig };
}
