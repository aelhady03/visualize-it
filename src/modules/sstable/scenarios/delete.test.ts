import { describe, expect, it } from "vitest";
import type { RunResult, Scenario, Step } from "@core/engine-contract";
import type { EngineState, Entry } from "../state";
import { isEngineState } from "../state";
import { init, run } from "../engine/index";
import { sstableEntries } from "../lib/derive";
import { deleteScenarios } from "./delete";

/** Chain a scenario's ops from init() / its seed, collecting steps + results. */
function play(scenario: Scenario<EngineState>): {
  steps: Step<EngineState>[];
  results: RunResult<EngineState>[];
} {
  const seed =
    scenario.seedState !== undefined
      ? (JSON.parse(JSON.stringify(scenario.seedState)) as EngineState)
      : undefined;
  let prev = seed ?? init();
  const steps: Step<EngineState>[] = [];
  const results: RunResult<EngineState>[] = [];
  for (const op of scenario.ops) {
    const r = run(op.opId, op.input, prev);
    expect(r.error).toBeUndefined();
    results.push(r);
    steps.push(...r.steps);
    prev = r.result;
  }
  return { steps, results };
}

/** Every version of `key` in the whole state: memtables, files, WAL, jobs. */
function everyEntry(state: EngineState, key: string): Entry[] {
  const found: Entry[] = [];
  for (const mt of state.memtables) for (const e of mt.entries) if (e.key === key) found.push(e);
  for (const sst of [...state.l0, ...state.levels.flat()])
    for (const e of sstableEntries(sst)) if (e.key === key) found.push(e);
  for (const w of state.wal) for (const e of w.entries) if (e.key === key) found.push(e);
  for (const job of state.jobs) for (const e of job.output) if (e.key === key) found.push(e);
  return found;
}

/** The tombstone entry for `key` in a state, or undefined. */
function tombstoneFor(state: EngineState, key: string): Entry | undefined {
  return everyEntry(state, key).find((e) => e.tombstone === true);
}

const KEPT_KINDS = [
  "wal.append",
  "memtable.insert",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "wal.append",
  "memtable.insert",
  "jobs.advance",
  "flush.complete",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "delete.wal.append",
  "delete.memtable.insert",
  "delete.jobs.advance",
  "delete.flush.complete",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "wal.append",
  "memtable.insert",
  "jobs.advance",
  "flush.complete",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "compact.advance",
  "compact.flush-complete",
  "compact.start",
  "compact.advance",
  "compact.advance",
  "compact.advance",
  "compact.complete",
  "read.memtable-active",
  "read.l0",
  "read.tombstone",
];

const DROPPED_KINDS = [
  "wal.append",
  "memtable.insert",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "wal.append",
  "memtable.insert",
  "jobs.advance",
  "flush.complete",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "wal.append",
  "memtable.insert",
  "jobs.advance",
  "flush.complete",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "delete.wal.append",
  "delete.memtable.insert",
  "delete.jobs.advance",
  "delete.flush.complete",
  "wal.append",
  "memtable.insert",
  "memtable.freeze",
  "jobs.advance",
  "wal.append",
  "memtable.insert",
  "jobs.advance",
  "flush.complete",
  "compact.start",
  "compact.advance",
  "compact.advance",
  "compact.advance",
  "compact.advance",
  "compact.complete",
  "read.memtable-active",
  "read.l0",
  "read.done",
];

describe("deleteScenarios", () => {
  it("keeps delete-tombstone first and exposes the kept/dropped pair", () => {
    expect(deleteScenarios).toHaveLength(3);
    expect(deleteScenarios[0].id).toBe("delete-tombstone");
    const kept = deleteScenarios[1];
    const dropped = deleteScenarios[2];
    expect(kept.id).toBe("delete-tombstone-kept");
    expect(dropped.id).toBe("delete-tombstone-dropped");
    for (const scenario of [kept, dropped]) {
      expect(scenario.seedState).toBeDefined();
      expect(isEngineState(scenario.seedState)).toBe(true);
      expect(scenario.seedState?.config.strategy).toBe("stcs");
      expect(scenario.ops.map((op) => op.opId)).toEqual(
        expect.arrayContaining(["write", "delete", "compact", "read"]),
      );
    }
  });

  describe("delete-tombstone-kept", () => {
    it("runs deterministically with the documented kind sequence", () => {
      const scenario = deleteScenarios[1];
      const a = play(scenario);
      expect(a).toEqual(play(scenario));
      expect(a.steps.map((s) => s.kind)).toEqual(KEPT_KINDS);
      const kinds = a.steps.map((s) => s.kind);
      expect(kinds.some((k) => k.startsWith("delete."))).toBe(true);
      expect(kinds.some((k) => k.startsWith("compact."))).toBe(true);
      expect(kinds).toContain("read.tombstone");
    });

    it("the partial compaction leaves the old file outside the merge and the tombstone survives", () => {
      const { steps } = play(deleteScenarios[1]);
      const final = steps[steps.length - 1].state;

      // The merged file kept the tombstone…
      const tombstone = tombstoneFor(final, "cherry");
      expect(tombstone).toBeDefined();
      expect(tombstone?.seq).toBe(5);
      // …and the OLD file, untouched by the partial merge, still holds the value.
      const stale = everyEntry(final, "cherry").find((e) => e.tombstone !== true);
      expect(stale).toBeDefined();
      expect(stale?.seq).toBe(1);
      expect(stale?.value).toBe("dark");
      // Both live in DIFFERENT files.
      const homes = new Set(
        [...final.l0].flatMap((sst) =>
          sstableEntries(sst).filter((e) => e.key === "cherry").map(() => sst.id),
        ),
      );
      expect(homes.size).toBe(2);
    });

    it("the final read reports not found because the tombstone shadows the old value", () => {
      const { steps } = play(deleteScenarios[1]);
      const read = steps[steps.length - 1];
      expect(read.kind).toBe("read.tombstone");
      expect(read.extras).toMatchObject({
        key: "cherry",
        found: false,
        tombstone: true,
        seq: 5,
      });
    });
  });

  describe("delete-tombstone-dropped", () => {
    it("runs deterministically with the documented kind sequence", () => {
      const scenario = deleteScenarios[2];
      const a = play(scenario);
      expect(a).toEqual(play(scenario));
      expect(a.steps.map((s) => s.kind)).toEqual(DROPPED_KINDS);
      const kinds = a.steps.map((s) => s.kind);
      expect(kinds.some((k) => k.startsWith("delete."))).toBe(true);
      expect(kinds.some((k) => k.startsWith("compact."))).toBe(true);
      expect(kinds).toContain("compact.complete");
    });

    it("the tombstone exists right up to the completing step and is GC'd by it", () => {
      const { steps } = play(deleteScenarios[2]);
      const completeIndex = steps.findIndex((s) => s.kind === "compact.complete");
      expect(completeIndex).toBeGreaterThan(0);
      // One step before completion the tombstone (and the old value) still exist.
      const before = steps[completeIndex - 1].state;
      expect(tombstoneFor(before, "cherry")).toBeDefined();
      expect(everyEntry(before, "cherry").some((e) => e.tombstone !== true)).toBe(true);
      // The completing step's state holds neither.
      const after = steps[completeIndex].state;
      expect(tombstoneFor(after, "cherry")).toBeUndefined();
      expect(everyEntry(after, "cherry")).toHaveLength(0);
    });

    it("ends with the key truly gone: no tombstone anywhere, and the read says not found", () => {
      const { steps } = play(deleteScenarios[2]);
      const final = steps[steps.length - 1].state;
      expect(tombstoneFor(final, "cherry")).toBeUndefined();
      expect(everyEntry(final, "cherry")).toHaveLength(0);

      const read = steps[steps.length - 1];
      expect(read.kind).toBe("read.done");
      expect(read.extras).toMatchObject({
        key: "cherry",
        found: false,
        tombstone: false,
      });
    });
  });
});
