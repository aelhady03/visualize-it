/**
 * sstable meta — the eager half of module discovery (PLAN.md §3.2).
 *
 * The shell reads `meta`, `operations` and `settings` from this file through
 * the eager meta glob (import.meta.glob on /src/modules/<id>/meta.ts) without
 * ever loading the engine, so the sidebar builds instantly.
 *
 * Written ONCE by the Wave 3 module lead (lane: lead). The five lanes do NOT
 * edit this file — escalate needed changes to the coordinator instead.
 */

import type { Operation, SettingSpec } from "@core/engine-contract";
import type { VizModule } from "@core/view-contract";
import type { EngineState } from "./state";

export const meta = {
  id: "sstable",
  title: "SSTable / LSM-Tree",
  description:
    "Sorted immutable files plus an in-memory table and a write-ahead log: watch writes, reads, updates, deletes, compaction and crash recovery inside an LSM-tree pipeline.",
  topics: ["lsm-tree", "compaction", "bloom-filter"],
  difficulty: "intermediate",
  category: "Storage Engines",
  order: 2,
} as const satisfies VizModule<EngineState>["meta"];

export const operations: Operation[] = [
  {
    id: "write",
    label: "Write",
    description:
      "Append key=value through the WAL into the MemTable; watch flushes land as SSTables in L0.",
    mode: "both",
    inputSchema: [
      { id: "key", label: "Key", type: "text", required: true, default: "apple" },
      { id: "value", label: "Value", type: "text", required: true, default: "red" },
    ],
  },
  {
    id: "read",
    label: "Read",
    description:
      "Probe the memtables, then SSTables newest-first: range check → bloom filter → sparse index → block scan.",
    mode: "both",
    inputSchema: [{ id: "key", label: "Key", type: "text", required: true, default: "apple" }],
  },
  {
    id: "update",
    label: "Update",
    description:
      "A blind write of a new version: the old value stays in its immutable file until compaction; seq decides who wins.",
    mode: "both",
    inputSchema: [
      { id: "key", label: "Key", type: "text", required: true, default: "apple" },
      { id: "value", label: "New value", type: "text", required: true, default: "green" },
    ],
  },
  {
    id: "delete",
    label: "Delete",
    description:
      "Write a tombstone through the normal write path. Reads stop at it; compaction GCs it once no older data can hide.",
    mode: "both",
    inputSchema: [{ id: "key", label: "Key", type: "text", required: true, default: "apple" }],
  },
  {
    id: "compact",
    label: "Compact",
    description:
      "Merge files to drop stale versions and tombstones and keep read amplification bounded. Strategy comes from the settings toggle.",
    mode: "both",
    // No-input op: an ABSENT inputSchema is allowed by the contract (§3.5,
    // check 6) — the shell renders a bare run button.
  },
  {
    id: "crash",
    label: "Crash & recover",
    description:
      "Wipe the memtables and jobs (memory is gone), then replay the unflushed WAL segments to rebuild them.",
    mode: "both",
    // No-input op, same as compact.
  },
  {
    id: "write-bulk",
    label: "Bulk write",
    description:
      "Insert N seeded random keys through the normal write path — reach flush and compaction states without typing 30 writes.",
    mode: "sandbox",
    inputSchema: [
      { id: "count", label: "Keys", type: "number", required: true, default: 24 },
      { id: "seed", label: "Seed", type: "number", required: true, default: 1 },
    ],
  },
];

export const settings: SettingSpec[] = [
  {
    id: "strategy",
    label: "Compaction strategy",
    type: "select",
    options: ["stcs", "leveled"],
    default: "stcs",
    hint: "stcs merges similar-size buckets; leveled keeps disjoint ranges per level.",
  },
  {
    id: "memtableCap",
    label: "MemTable capacity",
    type: "number",
    default: 6,
    hint: "Entries before the MemTable freezes and a flush starts.",
  },
  {
    id: "fanout",
    label: "Level fanout",
    type: "number",
    default: 3,
    hint: "Leveled target-size growth per level (demo 3, real engines ~10).",
  },
  {
    id: "l0Trigger",
    label: "L0 trigger",
    type: "number",
    default: 4,
    hint: "L0 file count that triggers compaction — and write stalls.",
  },
  {
    id: "stcsMinThreshold",
    label: "STCS bucket size",
    type: "number",
    default: 4,
    hint: "Files per similar-size bucket before a size-tiered merge.",
  },
];
