import { describe, it, expect } from "vitest";
import type { Block, EngineState, Entry, SSTable } from "../state";
import {
  compareKeys,
  sstableMinKey,
  sstableMaxKey,
  sparseIndex,
  entryBytes,
  liveBytes,
  isSorted,
  hasDuplicateKeysWithinFile,
  levelRangesDisjoint,
  seqDecreasesDownLevels,
} from "./derive";

function entry(id: string, key: string, value: string, seq: number, tombstone = false): Entry {
  return tombstone ? { id, key, value, seq, tombstone: true } : { id, key, value, seq };
}

function block(id: string, ...entries: Entry[]): Block {
  return { id, entries };
}

function sstable(id: string, seq: number, ...blocks: Block[]): SSTable {
  return { id, seq, blocks, bloom: new Array(16).fill(0), bytes: 0 };
}

describe("compareKeys", () => {
  it("is a total order matching JS string <", () => {
    expect(compareKeys("a", "b")).toBe(-1);
    expect(compareKeys("b", "a")).toBe(1);
    expect(compareKeys("a", "a")).toBe(0);
    expect(compareKeys("apple", "apples")).toBe(-1);
  });
});

describe("min/max keys", () => {
  it("derives min and max from blocks", () => {
    const sst = sstable(
      "s1",
      3,
      block("b1", entry("e1", "apple", "v", 1)),
      block("b2", entry("e2", "cherry", "v", 2), entry("e3", "fig", "v", 3)),
    );
    expect(sstableMinKey(sst)).toBe("apple");
    expect(sstableMaxKey(sst)).toBe("fig");
  });

  it("skips empty blocks", () => {
    const sst = sstable(
      "s1",
      1,
      block("b1"),
      block("b2", entry("e1", "mango", "v", 1)),
    );
    expect(sstableMinKey(sst)).toBe("mango");
    expect(sstableMaxKey(sst)).toBe("mango");
  });

  it("returns null for an empty file", () => {
    const sst = sstable("s1", 0, block("b1"));
    expect(sstableMinKey(sst)).toBeNull();
    expect(sstableMaxKey(sst)).toBeNull();
  });
});

describe("sparseIndex", () => {
  it("takes the first key of each non-empty block", () => {
    const blocks = [
      block("b1", entry("e1", "apple", "v", 1), entry("e2", "banana", "v", 2)),
      block("b2"),
      block("b3", entry("e3", "cherry", "v", 3)),
    ];
    expect(sparseIndex(blocks)).toEqual([
      { blockId: "b1", key: "apple" },
      { blockId: "b3", key: "cherry" },
    ]);
  });
});

describe("isSorted", () => {
  it("passes sorted input", () => {
    expect(isSorted([entry("e1", "a", "v", 1), entry("e2", "b", "v", 2)])).toBe(true);
  });

  it("passes non-decreasing input with adjacent equal keys (dups are a separate invariant)", () => {
    expect(isSorted([entry("e1", "a", "v", 1), entry("e2", "a", "v", 2)])).toBe(true);
  });

  it("catches a planted inversion", () => {
    expect(isSorted([entry("e1", "b", "v", 1), entry("e2", "a", "v", 2)])).toBe(false);
  });
});

describe("hasDuplicateKeysWithinFile", () => {
  it("catches a duplicate key spread across two blocks", () => {
    const sst = sstable(
      "s1",
      3,
      block("b1", entry("e1", "apple", "v1", 1)),
      block("b2", entry("e2", "apple", "v2", 3)),
    );
    expect(hasDuplicateKeysWithinFile(sst)).toBe(true);
  });

  it("passes a clean file", () => {
    const sst = sstable(
      "s1",
      2,
      block("b1", entry("e1", "apple", "v1", 1), entry("e2", "banana", "v2", 2)),
    );
    expect(hasDuplicateKeysWithinFile(sst)).toBe(false);
  });
});

describe("levelRangesDisjoint", () => {
  const l1a = sstable("l1a", 2, block("b1", entry("e1", "apple", "v", 1), entry("e2", "banana", "v", 2)));
  const l1b = sstable("l1b", 4, block("b2", entry("e3", "cherry", "v", 3), entry("e4", "date", "v", 4)));
  const l1c = sstable("l1c", 5, block("b3", entry("e5", "elderberry", "v", 5)));
  const overlapping = sstable("l1d", 6, block("b4", entry("e6", "banana", "v2", 6))); // overlaps l1a

  it("passes disjoint ranges", () => {
    expect(levelRangesDisjoint([l1a, l1b, l1c])).toBe(true);
  });

  it("catches a planted overlap", () => {
    expect(levelRangesDisjoint([l1a, l1b, overlapping])).toBe(false);
  });

  it("treats touching ranges as overlapping (a shared boundary key is a shared key)", () => {
    const touchA = sstable("ta", 1, block("b1", entry("e1", "apple", "v", 1), entry("e2", "cherry", "v", 2)));
    const touchB = sstable("tb", 3, block("b2", entry("e3", "cherry", "v2", 3)));
    expect(levelRangesDisjoint([touchA, touchB])).toBe(false);
  });

  it("ignores empty files", () => {
    const empty = sstable("empty", 0, block("b0"));
    expect(levelRangesDisjoint([l1a, empty, l1b])).toBe(true);
  });
});

describe("seqDecreasesDownLevels", () => {
  const baseState = (l0: SSTable[], levels: SSTable[][]): EngineState => ({
    seq: 100,
    wal: [],
    memtables: [],
    l0,
    levels,
    jobs: [],
    config: { strategy: "leveled" },
    metrics: { ingestedBytes: 0, bytesWritten: 0, diskBytes: 0, lastReadFiles: 0, lastReadBlocks: 0 },
  });

  it("passes a valid leveled state", () => {
    const l0 = [sstable("s2", 10, block("b1", entry("e1", "apple", "a1", 10)))];
    const l1 = [sstable("l1a", 5, block("b2", entry("e2", "apple", "a0", 5)))];
    expect(seqDecreasesDownLevels(baseState(l0, [l1]))).toEqual([]);
  });

  it("catches a deeper copy that is NEWER than the shallower one", () => {
    const l0 = [sstable("s2", 2, block("b1", entry("e1", "apple", "a0", 2)))];
    const l1 = [sstable("l1a", 5, block("b2", entry("e2", "apple", "a1", 5)))];
    const violations = seqDecreasesDownLevels(baseState(l0, [l1]));
    expect(violations).toEqual([
      { key: "apple", level: 0, seq: 2, deeperLevel: 1, deeperSeq: 5 },
    ]);
  });

  it("catches EQUAL seqs (strictly decreasing, not non-increasing)", () => {
    const l0 = [sstable("s2", 5, block("b1", entry("e1", "apple", "a1", 5)))];
    const l1 = [sstable("l1a", 5, block("b2", entry("e2", "apple", "a1", 5)))];
    expect(seqDecreasesDownLevels(baseState(l0, [l1])).length).toBe(1);
  });

  it("reports violations against EVERY deeper level, not just the adjacent one", () => {
    const l0 = [sstable("s2", 1, block("b1", entry("e1", "x", "v", 1)))];
    const l1: SSTable[] = [];
    const l2 = [sstable("l2a", 9, block("b2", entry("e2", "x", "v2", 9)))];
    const violations = seqDecreasesDownLevels(baseState(l0, [l1, l2]));
    expect(violations).toEqual([{ key: "x", level: 0, seq: 1, deeperLevel: 2, deeperSeq: 9 }]);
  });

  it("ignores keys that exist at only one level", () => {
    const l0 = [sstable("s2", 1, block("b1", entry("e1", "x", "v", 1)))];
    const l1 = [sstable("l1a", 2, block("b2", entry("e2", "y", "v", 2)))];
    expect(seqDecreasesDownLevels(baseState(l0, [l1]))).toEqual([]);
  });

  it("uses the MAX seq per key within L0 (L0 files overlap by design)", () => {
    const l0 = [
      sstable("s2", 9, block("b1", entry("e1", "x", "new", 9))),
      sstable("s3", 4, block("b2", entry("e2", "x", "old", 4))),
    ];
    const l1 = [sstable("l1a", 3, block("b3", entry("e3", "x", "older", 3)))];
    expect(seqDecreasesDownLevels(baseState(l0, [l1]))).toEqual([]);
  });
});

describe("entryBytes / liveBytes", () => {
  it("entryBytes is the documented estimator", () => {
    // id + key + value + 8 (seq)
    expect(entryBytes(entry("e1", "abc", "de", 99))).toBe(2 + 3 + 2 + 8);
  });

  it("liveBytes counts only the latest version of each key, across memtables and files", () => {
    const state: EngineState = {
      seq: 10,
      wal: [],
      memtables: [
        {
          id: "mt1",
          state: "active",
          entries: [entry("e3", "x", "v3", 9)], // newest x
          walSegment: "w1",
        },
      ],
      l0: [
        sstable("s1", 5, block("b1", entry("e1", "x", "v1", 1), entry("e2", "y", "v2", 5))),
      ],
      levels: [],
      jobs: [],
      config: { strategy: "stcs" },
      metrics: { ingestedBytes: 0, bytesWritten: 0, diskBytes: 0, lastReadFiles: 0, lastReadBlocks: 0 },
    };
    // stale x@1 (in s1) is excluded; y@5 (only copy) is included
    expect(liveBytes(state)).toBe(entryBytes(entry("e3", "x", "v3", 9)) + entryBytes(entry("e2", "y", "v2", 5)));
  });

  it("counts a latest tombstone (it occupies space until compaction GCs it)", () => {
    const state: EngineState = {
      seq: 10,
      wal: [],
      memtables: [],
      l0: [
        sstable(
          "s1",
          3,
          block("b1", entry("e1", "x", "", 3, true)),
        ),
      ],
      levels: [],
      jobs: [],
      config: { strategy: "stcs" },
      metrics: { ingestedBytes: 0, bytesWritten: 0, diskBytes: 0, lastReadFiles: 0, lastReadBlocks: 0 },
    };
    expect(liveBytes(state)).toBe(entryBytes(entry("e1", "x", "", 3, true)));
  });
});
