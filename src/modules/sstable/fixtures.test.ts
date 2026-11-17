import { describe, it, expect } from "vitest";
import flushInProgressRaw from "./fixtures/flush-in-progress.json?raw";
import leveledTwoLevelsRaw from "./fixtures/leveled-two-levels.json?raw";
import { isEngineState, type EngineState } from "./state";
import {
  isSorted,
  hasDuplicateKeysWithinFile,
  levelRangesDisjoint,
  seqDecreasesDownLevels,
  liveBytes,
  sstableEntries,
} from "./lib/derive";
import { maybe } from "./lib/bloom";

/** Fixtures are plain JSON, imported as raw text (?raw) and parsed. */

describe("fixtures", () => {
  const a = JSON.parse(flushInProgressRaw) as unknown;
  const b = JSON.parse(leveledTwoLevelsRaw) as unknown;

  it("both fixtures validate as EngineState via the type guards", () => {
    expect(isEngineState(a)).toBe(true);
    expect(isEngineState(b)).toBe(true);
  });

  it("both fixtures survive a JSON round-trip deep-equal", () => {
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  });

  describe("flush-in-progress (stcs)", () => {
    const s = a as EngineState;

    it("has one active + one immutable memtable, two WAL segments, two L0 files, one flush job", () => {
      expect(s.memtables.filter((m) => m.state === "active").length).toBe(1);
      expect(s.memtables.filter((m) => m.state === "immutable").length).toBe(1);
      expect(s.wal.length).toBe(2);
      expect(s.l0.length).toBe(2);
      expect(s.jobs.length).toBe(1);
      expect(s.jobs[0].kind).toBe("flush");
    });

    it("is stcs: files in l0, levels empty", () => {
      expect(s.config.strategy).toBe("stcs");
      expect(s.levels.length).toBe(0);
    });

    it("cross-references are consistent", () => {
      const walIds = new Set(s.wal.map((w) => w.id));
      const mtIds = new Set(s.memtables.map((m) => m.id));
      for (const mt of s.memtables) expect(walIds.has(mt.walSegment)).toBe(true);
      for (const job of s.jobs) for (const input of job.inputs) expect(mtIds.has(input)).toBe(true);
      // the flush job consumes the immutable memtable, 1 unit into a 2-unit job
      const flush = s.jobs[0];
      const target = s.memtables.find((m) => m.id === flush.inputs[0]);
      expect(target).toBeTruthy();
      expect(target!.state).toBe("immutable");
      expect(flush.progress).toBe(1);
      expect(flush.total).toBe(2);
    });

    it("every file passes the per-file invariants", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        expect(hasDuplicateKeysWithinFile(sst)).toBe(false);
        expect(isSorted(sstableEntries(sst))).toBe(true);
      }
      for (const mt of s.memtables) {
        expect(isSorted(mt.entries)).toBe(true);
      }
    });

    it("stored bloom filters match the real bloom implementation for every file key", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        for (const e of sstableEntries(sst)) {
          expect(maybe(sst.bloom, e.key)).toBe(true);
        }
      }
    });

    it("metrics match the documented byte estimator (fixture authored against it)", () => {
      expect(liveBytes(s)).toBe(338);
      // space amplification: 407 / 338
      expect(Math.abs(s.metrics.diskBytes / liveBytes(s) - 407 / 338) < 1e-12).toBe(true);
    });
  });

  describe("leveled-two-levels (leveled)", () => {
    const s = b as EngineState;

    it("is leveled with L0 + two levels", () => {
      expect(s.config.strategy).toBe("leveled");
      expect(s.l0.length).toBe(2);
      expect(s.levels.length).toBe(2);
    });

    it("L0 is ordered oldest first (by max seq)", () => {
      expect(s.l0[0].seq <= s.l0[1].seq).toBe(true);
    });

    it("satisfies every §8 invariant", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        expect(hasDuplicateKeysWithinFile(sst)).toBe(false);
        expect(isSorted(sstableEntries(sst))).toBe(true);
      }
      for (const level of s.levels) {
        expect(levelRangesDisjoint(level)).toBe(true);
      }
      expect(seqDecreasesDownLevels(s)).toEqual([]);
    });

    it("has an in-flight compaction job consuming two L1 files", () => {
      const job = s.jobs[0];
      expect(job.kind).toBe("compaction");
      expect(job.inputs).toEqual(["l1a", "l1b"]);
      expect(job.progress).toBe(1);
      expect(job.total).toBe(job.inputs.length); // inputs.length units
    });

    it("stored bloom filters match the real bloom implementation for every file key", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        for (const e of sstableEntries(sst)) {
          expect(maybe(sst.bloom, e.key)).toBe(true);
        }
      }
    });

    it("metrics match the documented byte estimator", () => {
      expect(liveBytes(s)).toBe(238);
      expect(Math.abs(s.metrics.diskBytes / liveBytes(s) - 308 / 238) < 1e-12).toBe(true);
    });
  });
});
