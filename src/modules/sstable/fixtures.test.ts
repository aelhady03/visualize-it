// Uses node:test + tsx (no build system yet). Port to Vitest mechanically once the Wave 0 scaffold lands.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/** Fixtures are plain JSON — read them off disk (no JSON import attributes needed). */
function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("fixtures", () => {
  const a = loadFixture("flush-in-progress.json");
  const b = loadFixture("leveled-two-levels.json");

  it("both fixtures validate as EngineState via the type guards", () => {
    assert.equal(isEngineState(a), true, "flush-in-progress.json must be a valid EngineState");
    assert.equal(isEngineState(b), true, "leveled-two-levels.json must be a valid EngineState");
  });

  it("both fixtures survive a JSON round-trip deep-equal", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
    assert.deepEqual(JSON.parse(JSON.stringify(b)), b);
  });

  describe("flush-in-progress (stcs)", () => {
    const s = a as EngineState;

    it("has one active + one immutable memtable, two WAL segments, two L0 files, one flush job", () => {
      assert.equal(s.memtables.filter((m) => m.state === "active").length, 1);
      assert.equal(s.memtables.filter((m) => m.state === "immutable").length, 1);
      assert.equal(s.wal.length, 2);
      assert.equal(s.l0.length, 2);
      assert.equal(s.jobs.length, 1);
      assert.equal(s.jobs[0].kind, "flush");
    });

    it("is stcs: files in l0, levels empty", () => {
      assert.equal(s.config.strategy, "stcs");
      assert.equal(s.levels.length, 0);
    });

    it("cross-references are consistent", () => {
      const walIds = new Set(s.wal.map((w) => w.id));
      const mtIds = new Set(s.memtables.map((m) => m.id));
      for (const mt of s.memtables) assert.ok(walIds.has(mt.walSegment), `${mt.id} → ${mt.walSegment}`);
      for (const job of s.jobs) for (const input of job.inputs) assert.ok(mtIds.has(input), job.id);
      // the flush job consumes the immutable memtable, 1 unit into a 2-unit job
      const flush = s.jobs[0];
      const target = s.memtables.find((m) => m.id === flush.inputs[0]);
      assert.ok(target);
      assert.equal(target.state, "immutable");
      assert.equal(flush.progress, 1);
      assert.equal(flush.total, 2);
    });

    it("every file passes the per-file invariants", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        assert.equal(hasDuplicateKeysWithinFile(sst), false, `${sst.id} duplicate keys`);
        assert.equal(isSorted(sstableEntries(sst)), true, `${sst.id} sorted`);
      }
      for (const mt of s.memtables) {
        assert.equal(isSorted(mt.entries), true, `${mt.id} sorted`);
      }
    });

    it("stored bloom filters match the real bloom implementation for every file key", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        for (const e of sstableEntries(sst)) {
          assert.equal(maybe(sst.bloom, e.key), true, `${sst.id}: bloom must contain ${e.key}`);
        }
      }
    });

    it("metrics match the documented byte estimator (fixture authored against it)", () => {
      assert.equal(liveBytes(s), 338);
      // space amplification: 407 / 338
      assert.ok(Math.abs(s.metrics.diskBytes / liveBytes(s) - 407 / 338) < 1e-12);
    });
  });

  describe("leveled-two-levels (leveled)", () => {
    const s = b as EngineState;

    it("is leveled with L0 + two levels", () => {
      assert.equal(s.config.strategy, "leveled");
      assert.equal(s.l0.length, 2);
      assert.equal(s.levels.length, 2);
    });

    it("L0 is ordered oldest first (by max seq)", () => {
      assert.ok(s.l0[0].seq <= s.l0[1].seq);
    });

    it("satisfies every §8 invariant", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        assert.equal(hasDuplicateKeysWithinFile(sst), false, `${sst.id}`);
        assert.equal(isSorted(sstableEntries(sst)), true, `${sst.id}`);
      }
      for (const level of s.levels) {
        assert.equal(levelRangesDisjoint(level), true, "level ranges must be disjoint");
      }
      assert.deepEqual(seqDecreasesDownLevels(s), [], "per-key seq must strictly decrease down levels");
    });

    it("has an in-flight compaction job consuming two L1 files", () => {
      const job = s.jobs[0];
      assert.equal(job.kind, "compaction");
      assert.deepEqual(job.inputs, ["l1a", "l1b"]);
      assert.equal(job.progress, 1);
      assert.equal(job.total, job.inputs.length); // inputs.length units
    });

    it("stored bloom filters match the real bloom implementation for every file key", () => {
      for (const sst of [...s.l0, ...s.levels.flat()]) {
        for (const e of sstableEntries(sst)) {
          assert.equal(maybe(sst.bloom, e.key), true, `${sst.id}: bloom must contain ${e.key}`);
        }
      }
    });

    it("metrics match the documented byte estimator", () => {
      assert.equal(liveBytes(s), 238);
      assert.ok(Math.abs(s.metrics.diskBytes / liveBytes(s) - 308 / 238) < 1e-12);
    });
  });
});
