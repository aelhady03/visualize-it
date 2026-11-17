// Uses node:test + tsx (no build system yet). Port to Vitest mechanically once the Wave 0 scaffold lands.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(defaultConfig.memtableCap, 6);
    assert.equal(defaultConfig.blockSize, 2);
    assert.equal(defaultConfig.bloomBits, 16);
    assert.equal(defaultConfig.bloomHashes, 2);
    assert.equal(defaultConfig.strategy, "stcs");
    assert.equal(defaultConfig.l0Trigger, 4);
    assert.equal(defaultConfig.stcsMinThreshold, 4);
    assert.equal(defaultConfig.fanout, 3); // demo value; real engines ~10
  });

  it("targetFileSize is a positive, documented demo-scale number", () => {
    assert.ok(defaultConfig.targetFileSize > 0);
  });

  it("defaultEngineConfig returns a plain JSON-safe config bag", () => {
    const config = defaultEngineConfig();
    assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
    assert.equal(config.strategy, "stcs");
  });
});

describe("type guards", () => {
  const goodEntry: Entry = { id: "e1", key: "apple", value: "v", seq: 1 };

  it("isEntry accepts a plain entry, with or without tombstone", () => {
    assert.equal(isEntry(goodEntry), true);
    assert.equal(isEntry({ ...goodEntry, tombstone: true }), true);
    assert.equal(isEntry({ ...goodEntry, tombstone: false }), true);
  });

  it("isEntry rejects wrong shapes", () => {
    assert.equal(isEntry(null), false);
    assert.equal(isEntry({ id: "e1", key: "k" }), false); // missing value/seq
    assert.equal(isEntry({ ...goodEntry, seq: "1" }), false); // string seq
    assert.equal(isEntry({ ...goodEntry, seq: NaN }), false);
    assert.equal(isEntry({ ...goodEntry, tombstone: 1 }), false); // non-boolean flag
    assert.equal(isEntry([goodEntry]), false);
  });

  it("isBlock / isWalSegment / isMemTable / isJob structural checks", () => {
    assert.equal(isBlock({ id: "b1", entries: [goodEntry] }), true);
    assert.equal(isBlock({ id: "b1", entries: [goodEntry, 42] }), false);

    assert.equal(isWalSegment({ id: "w1", entries: [goodEntry] }), true);
    assert.equal(isWalSegment({ id: "w1", entries: "no" }), false);

    assert.equal(
      isMemTable({ id: "mt1", state: "active", entries: [goodEntry], walSegment: "w1" }),
      true,
    );
    assert.equal(
      isMemTable({ id: "mt1", state: "frozen", entries: [], walSegment: "w1" }),
      false,
    );

    assert.equal(
      isJob({ id: "j1", kind: "flush", inputs: ["mt1"], output: [goodEntry], progress: 1, total: 2 }),
      true,
    );
    assert.equal(
      isJob({ id: "j1", kind: "vacuum", inputs: [], output: [], progress: 0, total: 1 }),
      false,
    );
  });

  it("isSSTable requires a 16-bit 0/1 bloom", () => {
    const base = { id: "s1", seq: 1, blocks: [], bytes: 0 };
    assert.equal(isSSTable({ ...base, bloom: new Array(16).fill(0) }), true);
    assert.equal(isSSTable({ ...base, bloom: [0, 1] }), false); // wrong length
    assert.equal(isSSTable({ ...base, bloom: new Array(16).fill(2) }), false); // not bits
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
    assert.equal(isEngineState(state), true);
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
    assert.equal(isEngineState({ ...good, l0: [{ id: "s1" }] }), false);
    assert.equal(isEngineState({ ...good, metrics: {} }), false);
    assert.equal(isEngineState({ ...good, config: { bad: null } }), false);
    assert.equal(isEngineState({ ...good, seq: "two" }), false);
  });
});
