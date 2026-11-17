import { describe, it, expect } from "vitest";
import {
  isEntry,
  isBlock,
  isSSTable,
  isMemTable,
  isWalSegment,
  isJob,
  isEngineState,
  type Entry,
} from "./state";
import { defaultConfig, defaultEngineConfig } from "./defaults";

describe("defaults", () => {
  it("matches PLAN.md §5.1 values", () => {
    expect(defaultConfig.memtableCap).toBe(6);
    expect(defaultConfig.blockSize).toBe(2);
    expect(defaultConfig.bloomBits).toBe(16);
    expect(defaultConfig.bloomHashes).toBe(2);
    expect(defaultConfig.strategy).toBe("stcs");
    expect(defaultConfig.l0Trigger).toBe(4);
    expect(defaultConfig.stcsMinThreshold).toBe(4);
    expect(defaultConfig.fanout).toBe(3); // demo value; real engines ~10
  });

  it("targetFileSize is a positive, documented demo-scale number", () => {
    expect(defaultConfig.targetFileSize > 0).toBe(true);
  });

  it("defaultEngineConfig returns a plain JSON-safe config bag", () => {
    const config = defaultEngineConfig();
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
    expect(config.strategy).toBe("stcs");
  });
});

describe("type guards", () => {
  const goodEntry: Entry = { id: "e1", key: "apple", value: "v", seq: 1 };

  it("isEntry accepts a plain entry, with or without tombstone", () => {
    expect(isEntry(goodEntry)).toBe(true);
    expect(isEntry({ ...goodEntry, tombstone: true })).toBe(true);
    expect(isEntry({ ...goodEntry, tombstone: false })).toBe(true);
  });

  it("isEntry rejects wrong shapes", () => {
    expect(isEntry(null)).toBe(false);
    expect(isEntry({ id: "e1", key: "k" })).toBe(false); // missing value/seq
    expect(isEntry({ ...goodEntry, seq: "1" })).toBe(false); // string seq
    expect(isEntry({ ...goodEntry, seq: NaN })).toBe(false);
    expect(isEntry({ ...goodEntry, tombstone: 1 })).toBe(false); // non-boolean flag
    expect(isEntry([goodEntry])).toBe(false);
  });

  it("isBlock / isWalSegment / isMemTable / isJob structural checks", () => {
    expect(isBlock({ id: "b1", entries: [goodEntry] })).toBe(true);
    expect(isBlock({ id: "b1", entries: [goodEntry, 42] })).toBe(false);

    expect(isWalSegment({ id: "w1", entries: [goodEntry] })).toBe(true);
    expect(isWalSegment({ id: "w1", entries: "no" })).toBe(false);

    expect(isMemTable({ id: "mt1", state: "active", entries: [goodEntry], walSegment: "w1" })).toBe(true);
    expect(isMemTable({ id: "mt1", state: "frozen", entries: [], walSegment: "w1" })).toBe(false);

    expect(
      isJob({ id: "j1", kind: "flush", inputs: ["mt1"], output: [goodEntry], progress: 1, total: 2 }),
    ).toBe(true);
    expect(
      isJob({ id: "j1", kind: "vacuum", inputs: [], output: [], progress: 0, total: 1 }),
    ).toBe(false);
  });

  it("isSSTable requires a 16-bit 0/1 bloom", () => {
    const base = { id: "s1", seq: 1, blocks: [], bytes: 0 };
    expect(isSSTable({ ...base, bloom: new Array(16).fill(0) })).toBe(true);
    expect(isSSTable({ ...base, bloom: [0, 1] })).toBe(false); // wrong length
    expect(isSSTable({ ...base, bloom: new Array(16).fill(2) })).toBe(false); // not bits
  });

  it("isEngineState accepts a minimal well-formed state", () => {
    const state = {
      seq: 2,
      wal: [{ id: "w1", entries: [goodEntry] }],
      memtables: [{ id: "mt1", state: "active", entries: [goodEntry], walSegment: "w1" }],
      l0: [{ id: "s1", seq: 1, blocks: [{ id: "b1", entries: [goodEntry] }], bloom: new Array(16).fill(0), bytes: 1 }],
      levels: [],
      jobs: [],
      config: { strategy: "stcs", memtableCap: 6 },
      metrics: { ingestedBytes: 0, bytesWritten: 0, diskBytes: 0, lastReadFiles: 0, lastReadBlocks: 0 },
    };
    expect(isEngineState(state)).toBe(true);
  });

  it("isEngineState rejects nested garbage", () => {
    const good = {
      seq: 2,
      wal: [],
      memtables: [],
      l0: [],
      levels: [],
      jobs: [],
      config: {},
      metrics: { ingestedBytes: 0, bytesWritten: 0, diskBytes: 0, lastReadFiles: 0, lastReadBlocks: 0 },
    };
    expect(isEngineState({ ...good, l0: [{ id: "s1" }] })).toBe(false);
    expect(isEngineState({ ...good, metrics: {} })).toBe(false);
    expect(isEngineState({ ...good, config: { bad: null } })).toBe(false);
    expect(isEngineState({ ...good, seq: "two" })).toBe(false);
  });
});
