/**
 * Resolved-config helper for the engine (pure: no React, no npm packages).
 *
 * `EngineState.config` is the loose `Config` bag from the frozen contract
 * (`Record<string, string | number | boolean>`), so any value could be wrong
 * or missing. Engine code that needs a concrete number goes through
 * `resolveConfig`, which validates each key and falls back to defaultConfig.
 *
 * Note: bloomBits/bloomHashes are resolved here, but lib/bloom.ts is fixed at
 * 16 bits / k=2 in this teaching lane — the resolved values document intent;
 * the implementation constants are the truth.
 */

import { defaultConfig, type CompactionStrategy, type Config, type SstableConfig } from "../state";

/** Positive integer, floored; anything non-numeric, non-finite or < 1 → fallback. */
function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

/** Only the two known strategies exist; anything else falls back to stcs. */
export function resolveStrategy(value: unknown): CompactionStrategy {
  return value === "leveled" ? "leveled" : "stcs";
}

/** Validated, fully-populated config — every key present, every value sane. */
export function resolveConfig(config: Config | undefined): SstableConfig {
  const c = config ?? {};
  return {
    memtableCap: positiveInt(c.memtableCap, defaultConfig.memtableCap),
    blockSize: positiveInt(c.blockSize, defaultConfig.blockSize),
    bloomBits: positiveInt(c.bloomBits, defaultConfig.bloomBits),
    bloomHashes: positiveInt(c.bloomHashes, defaultConfig.bloomHashes),
    strategy: resolveStrategy(c.strategy),
    l0Trigger: positiveInt(c.l0Trigger, defaultConfig.l0Trigger),
    stcsMinThreshold: positiveInt(c.stcsMinThreshold, defaultConfig.stcsMinThreshold),
    fanout: positiveInt(c.fanout, defaultConfig.fanout),
    targetFileSize: positiveInt(c.targetFileSize, defaultConfig.targetFileSize),
  };
}
