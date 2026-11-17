/**
 * SSTable / LSM-tree engine state — the exact type model from PLAN.md §5.1.
 *
 * Self-contained: no imports from @core or anywhere else. Every type is
 * JSON-serializable by design — plain objects and arrays only, no Map,
 * no Date, no classes, no reliance on `undefined` surviving a round-trip
 * (optional fields like `tombstone` simply disappear when absent).
 *
 * This file is the source of truth for the module's state shape. The engine,
 * render, and fixture lanes all type against these declarations.
 */

/** Loose settings bag — mirrors `Config` from the frozen engine contract. */
export type Config = Record<string, string | number | boolean>;

/** Compaction strategies. stcs = size-tiered; leveled = L0 + disjoint levels. */
export type CompactionStrategy = "stcs" | "leveled";

/**
 * Resolved config keys for this module (defaults live in ./defaults.ts).
 * `EngineState.config` is typed as the loose `Config` (per the contract);
 * engine code that reads a specific setting narrows with these types.
 */
export interface SstableConfig {
  memtableCap: number; // entries per MemTable before it freezes
  blockSize: number; // entries per data block (~2 for the demo)
  bloomBits: number; // bloom filter width (16 for the demo)
  bloomHashes: number; // bloom filter hash count (2 for the demo)
  strategy: CompactionStrategy;
  l0Trigger: number; // L0 file count that triggers/would-trigger compaction
  stcsMinThreshold: number; // files per size bucket before a merge
  fanout: number; // leveled target-size growth per level (demo 3, real ~10)
  targetFileSize: number; // leveled output file split size, in bytes
}

/** One key/value record. `seq` is the reconciliation authority (§5.2 Read). */
export interface Entry {
  id: string; // stable entity id, e.g. "e17"
  key: string; // string keys, lexicographic order
  value: string;
  seq: number; // monotonic sequence number — highest seq wins
  tombstone?: boolean; // deletion marker; absent === false
}

/** A sorted block of entries inside an SSTable. Block size is ~2 (demo). */
export interface Block {
  id: string;
  entries: Entry[];
}

/**
 * An immutable on-disk file. minKey/maxKey/sparse index are DERIVED from
 * blocks, never stored separately (no invariant drift, PLAN.md §5.1).
 */
export interface SSTable {
  id: string; // stable id; age ordering in L0 uses seq, not creation
  seq: number; // MAX entry seq in this file (see Read §5.2)
  blocks: Block[];
  bloom: number[]; // bit array, 16 bits, k=2
  bytes: number; // for amplification metrics
}

/** The in-memory write buffer. A Map is NOT JSON-serializable → sorted array. */
export interface MemTable {
  id: string;
  state: "active" | "immutable";
  entries: Entry[]; // sorted by key
  walSegment: string; // id of its WAL segment
}

/** A durable append-only segment; one per MemTable, truncated after flush. */
export interface WalSegment {
  id: string;
  entries: Entry[];
}

/**
 * Background work in flight. Jobs advance 1 unit per subsequent user
 * operation; a flush needs 2 units, a compaction `inputs.length` units
 * (PLAN.md §5.1 background jobs model).
 */
export interface Job {
  id: string;
  kind: "flush" | "compaction";
  inputs: string[]; // entity ids being consumed (memtable / sstable ids)
  output: Entry[]; // merge stream so far — this is what renders mid-merge
  progress: number; // units done
  total: number; // units to completion
}

/** Cumulative counters; liveBytes is DERIVED (lib/derive.ts), never stored. */
export interface Metrics {
  ingestedBytes: number; // cumulative bytes written by users
  bytesWritten: number; // cumulative bytes flushed + compaction outputs
  diskBytes: number; // current bytes on disk
  lastReadFiles: number; // files probed by the last read
  lastReadBlocks: number; // blocks probed by the last read
}

/**
 * The full engine snapshot (PLAN.md §5.1). JSON-serializable by design.
 *
 * l0:   flushed files, OVERLAPPING ranges.
 *       leveled → L0 ordered by age (oldest first);
 *       stcs    → all files live here as UNORDERED sorted runs; levels = [].
 * levels: leveled only; index 0 is L1. Ranges are disjoint within a level,
 *       and target sizes grow ~fanout per level.
 */
export interface EngineState {
  seq: number; // logical clock + next sequence number
  wal: WalSegment[]; // one segment per MemTable; truncated after flush
  memtables: MemTable[]; // ≤1 active; others immutable, being flushed
  l0: SSTable[];
  levels: SSTable[][];
  jobs: Job[];
  config: Config; // resolved settings, defaults from ./defaults.ts
  metrics: Metrics;
}

// ---------------------------------------------------------------------------
// Type guards — structural validation used by fixtures and tests. They check
// required fields and their JSON-level types; they do NOT check invariants
// (sortedness, disjoint ranges, seq ordering — lib/derive.ts owns those).
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

export function isEntry(x: unknown): x is Entry {
  if (!isRecord(x)) return false;
  return (
    typeof x.id === "string" &&
    typeof x.key === "string" &&
    typeof x.value === "string" &&
    typeof x.seq === "number" &&
    Number.isFinite(x.seq) &&
    (x.tombstone === undefined || typeof x.tombstone === "boolean")
  );
}

export function isBlock(x: unknown): x is Block {
  if (!isRecord(x)) return false;
  return typeof x.id === "string" && Array.isArray(x.entries) && x.entries.every(isEntry);
}

export function isSSTable(x: unknown): x is SSTable {
  if (!isRecord(x)) return false;
  return (
    typeof x.id === "string" &&
    typeof x.seq === "number" &&
    Number.isFinite(x.seq) &&
    Array.isArray(x.blocks) &&
    x.blocks.every(isBlock) &&
    Array.isArray(x.bloom) &&
    x.bloom.length === 16 &&
    x.bloom.every((b) => b === 0 || b === 1) &&
    typeof x.bytes === "number" &&
    Number.isFinite(x.bytes)
  );
}

export function isMemTable(x: unknown): x is MemTable {
  if (!isRecord(x)) return false;
  return (
    typeof x.id === "string" &&
    (x.state === "active" || x.state === "immutable") &&
    Array.isArray(x.entries) &&
    x.entries.every(isEntry) &&
    typeof x.walSegment === "string"
  );
}

export function isWalSegment(x: unknown): x is WalSegment {
  if (!isRecord(x)) return false;
  return typeof x.id === "string" && Array.isArray(x.entries) && x.entries.every(isEntry);
}

export function isJob(x: unknown): x is Job {
  if (!isRecord(x)) return false;
  return (
    typeof x.id === "string" &&
    (x.kind === "flush" || x.kind === "compaction") &&
    isStringArray(x.inputs) &&
    Array.isArray(x.output) &&
    x.output.every(isEntry) &&
    typeof x.progress === "number" &&
    Number.isFinite(x.progress) &&
    typeof x.total === "number" &&
    Number.isFinite(x.total)
  );
}

export function isConfig(x: unknown): x is Config {
  if (!isRecord(x)) return false;
  return Object.values(x).every(
    (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  );
}

export function isMetrics(x: unknown): x is Metrics {
  if (!isRecord(x)) return false;
  return (
    typeof x.ingestedBytes === "number" &&
    typeof x.bytesWritten === "number" &&
    typeof x.diskBytes === "number" &&
    typeof x.lastReadFiles === "number" &&
    typeof x.lastReadBlocks === "number" &&
    [x.ingestedBytes, x.bytesWritten, x.diskBytes, x.lastReadFiles, x.lastReadBlocks].every(
      (n) => Number.isFinite(n),
    )
  );
}

/** Recursively validates a full state snapshot (structure, not invariants). */
export function isEngineState(x: unknown): x is EngineState {
  if (!isRecord(x)) return false;
  return (
    typeof x.seq === "number" &&
    Number.isFinite(x.seq) &&
    Array.isArray(x.wal) &&
    x.wal.every(isWalSegment) &&
    Array.isArray(x.memtables) &&
    x.memtables.every(isMemTable) &&
    Array.isArray(x.l0) &&
    x.l0.every(isSSTable) &&
    Array.isArray(x.levels) &&
    x.levels.every((level) => Array.isArray(level) && level.every(isSSTable)) &&
    Array.isArray(x.jobs) &&
    x.jobs.every(isJob) &&
    isConfig(x.config) &&
    isMetrics(x.metrics)
  );
}
