/**
 * Scenarios for the delete op — filled by the UPDATE/DELETE lane.
 *
 *   - "delete-tombstone" — six writes fill and freeze the first MemTable;
 *     deleting one of its keys writes a tombstone through the normal path.
 *     The flush that lands during the delete puts the OLD value in an L0
 *     SSTable, while the tombstone (higher seq) sits in the active MemTable
 *     and shadows it.
 *   - "delete-tombstone-kept" (Wave 4, PLAN.md §5.3) — delete, then a
 *     PARTIAL size-tiered compaction: an older file holding the key stays
 *     OUTSIDE the merged bucket, so the tombstone must survive; the read
 *     still says not found.
 *   - "delete-tombstone-dropped" (Wave 4) — delete, then a FULL compaction:
 *     every file holding the key is inside the merge and nothing older can
 *     hide outside it, so the tombstone is garbage-collected and the key is
 *     truly gone.
 *
 * The kept-vs-dropped contrast is the classic tombstone-GC gotcha
 * (PLAN.md §5.2 Delete): drop a tombstone while older data can still exist
 * outside the merge and the deleted value resurrects.
 *
 * Both new scenarios use a demo-friendly seed (memtableCap 2 so files land
 * fast, stcsMinThreshold 3 so the partial merge needs exactly three files
 * and the survivors don't re-trigger another merge, l0Trigger 5 so the chain
 * never trips a write-stall narration). Strategy is stcs — the default.
 *
 * "delete-tombstone-kept" trace: s1 lands holding cherry=dark@1 beside a
 * long companion entry, so it is much BIGGER than the small files that
 * follow — it ends up in its own size tier. The delete writes cherry†@5,
 * which flushes into s5. Two more small files land, so at compact time the
 * qualifying bucket is [s3, s5, s7] and s1 stays OUTSIDE the merge. The GC
 * rule sees s1 (older seq, range covers cherry) and keeps the tombstone:
 * the merged output still holds cherry†, and the read reports not found.
 *
 * "delete-tombstone-dropped" trace: four same-size files land in ONE size
 * bucket — s1 holds cherry=dark@2 and s7 holds cherry†@7. The merge takes
 * all four, nothing older exists outside the inputs, so the tombstone (and
 * with it the old value) drops out of the output entirely. The final read
 * walks a single file that no longer holds the key: not found, and no
 * tombstone remains anywhere in state.
 *
 * Export signature (lanes must keep it):
 *   export const deleteScenarios: Scenario<EngineState>[] = [...]
 */

import type { Scenario } from "@core/engine-contract";
import type { EngineState } from "../state";
import { init } from "../engine/index";

/** Seed for the kept/dropped pair: tiny memtable + small bucket threshold. */
const tombstoneSeed: EngineState = init({ memtableCap: 2, stcsMinThreshold: 3, l0Trigger: 5 });

export const deleteScenarios: Scenario<EngineState>[] = [
  {
    id: "delete-tombstone",
    title: "A delete is a tombstone write",
    description:
      "Six writes fill and freeze the first MemTable. Deleting one of its keys writes a tombstone through the normal path: the flush that lands during the delete puts the OLD value in an L0 SSTable, while the tombstone (higher seq) sits in the active MemTable and shadows it — the key reads as missing, but the old bytes stay until compaction.",
    ops: [
      { opId: "write", input: { key: "apple", value: "red" } },
      { opId: "write", input: { key: "banana", value: "yellow" } },
      { opId: "write", input: { key: "cherry", value: "dark" } },
      { opId: "write", input: { key: "date", value: "brown" } },
      { opId: "write", input: { key: "elderberry", value: "purple" } },
      { opId: "write", input: { key: "fig", value: "green" } },
      { opId: "delete", input: { key: "cherry" } },
    ],
  },
  {
    id: "delete-tombstone-kept",
    title: "Tombstone kept: a partial compaction must not drop it",
    description:
      "cherry is flushed into a big file, deleted, and its tombstone flushed into a small one. Compacting the bucket of small files leaves the big old file outside the merge — older data for cherry could still hide there, so the tombstone survives and the read still says not found.",
    seedState: tombstoneSeed,
    ops: [
      { opId: "write", input: { key: "cherry", value: "dark" } },
      { opId: "write", input: { key: "watermelon", value: "juicy-sweet" } }, // freeze (cap 2)
      { opId: "write", input: { key: "a", value: "1" } }, // flush advances 1/2
      { opId: "write", input: { key: "b", value: "2" } }, // s1 lands: cherry=dark@1 (+big key)
      { opId: "delete", input: { key: "cherry" } }, // tombstone @5; s3 lands: a, b
      { opId: "write", input: { key: "c", value: "3" } }, // tombstone freezes with c
      { opId: "write", input: { key: "d", value: "4" } }, // s5 lands: c, cherry†@5
      { opId: "write", input: { key: "e", value: "5" } }, // next flush in flight
      { opId: "compact" }, // s7 lands: d, e; bucket [s3,s5,s7] starts — s1 outside
      { opId: "compact" }, // merge advances 1/3
      { opId: "compact" }, // merge advances 2/3
      { opId: "compact" }, // merge completes: tombstone kept (s1 could hold cherry)
      { opId: "read", input: { key: "cherry" } }, // not found: the tombstone still shadows
    ],
  },
  {
    id: "delete-tombstone-dropped",
    title: "Tombstone dropped: a full compaction garbage-collects it",
    description:
      "cherry is flushed into a file and then deleted; its tombstone flushes into a same-size file. All four files form ONE size bucket, so the merge takes everything — no older data for the key can exist outside the inputs, and the tombstone is garbage-collected. The read says not found and no tombstone remains in state.",
    seedState: tombstoneSeed,
    ops: [
      { opId: "write", input: { key: "apple", value: "red" } },
      { opId: "write", input: { key: "cherry", value: "dark" } }, // freeze (cap 2)
      { opId: "write", input: { key: "kiwi", value: "green" } }, // flush advances 1/2
      { opId: "write", input: { key: "lemon", value: "yellow" } }, // s1 lands: apple, cherry=dark@2
      { opId: "write", input: { key: "mango", value: "orange" } }, // s3 lands: kiwi, lemon
      { opId: "write", input: { key: "fig", value: "purple" } }, // next flush in flight
      { opId: "delete", input: { key: "cherry" } }, // tombstone @7; s5 lands: fig, mango
      { opId: "write", input: { key: "peach", value: "pink" } }, // tombstone freezes with peach
      { opId: "write", input: { key: "plum", value: "dark" } }, // s7 lands: cherry†@7, peach
      { opId: "compact" }, // one bucket of 4: the merge job starts
      { opId: "compact" }, // merge advances 1/4
      { opId: "compact" }, // merge advances 2/4
      { opId: "compact" }, // merge advances 3/4
      { opId: "compact" }, // merge completes: tombstone GC'd — nothing older outside
      { opId: "read", input: { key: "cherry" } }, // not found, and no tombstone remains
    ],
  },
];
