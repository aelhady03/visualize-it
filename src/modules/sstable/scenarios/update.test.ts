import { describe, expect, it } from "vitest";
import type { RunResult, Scenario, Step } from "@core/engine-contract";
import type { EngineState } from "../state";
import { isEngineState } from "../state";
import { init, run } from "../engine/index";
import { sstableEntries } from "../lib/derive";
import { updateScenarios } from "./update";

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

/** Every version of `key` across memtables and files, tagged with its home. */
function versionsOf(state: EngineState, key: string) {
  const out: Array<{ home: string; seq: number; value: string; tombstone?: boolean }> = [];
  for (const mt of state.memtables) {
    for (const e of mt.entries) {
      if (e.key === key) out.push({ home: mt.id, seq: e.seq, value: e.value, tombstone: e.tombstone });
    }
  }
  for (const sst of [...state.l0, ...state.levels.flat()]) {
    for (const e of sstableEntries(sst)) {
      if (e.key === key) out.push({ home: sst.id, seq: e.seq, value: e.value, tombstone: e.tombstone });
    }
  }
  return out;
}

describe("updateScenarios", () => {
  it("keeps update-immutability first and exposes update-latest-wins", () => {
    expect(updateScenarios).toHaveLength(2);
    expect(updateScenarios[0].id).toBe("update-immutability");
    const scenario = updateScenarios[1];
    expect(scenario.id).toBe("update-latest-wins");
    expect(scenario.ops[0].opId).toBe("write");
    expect(scenario.seedState).toBeDefined();
    expect(isEngineState(scenario.seedState)).toBe(true);
    expect(scenario.seedState?.config.strategy).toBe("stcs");
  });

  it("runs deterministically with the documented kind sequence", () => {
    const scenario = updateScenarios[1];
    const a = play(scenario);
    expect(a).toEqual(play(scenario));
    expect(a.steps.map((s) => s.kind)).toEqual([
      "wal.append",
      "memtable.insert",
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
      "update.wal.append",
      "update.memtable.insert",
      "update.memtable.freeze",
      "update.jobs.advance",
      "wal.append",
      "memtable.insert",
      "jobs.advance",
      "flush.complete",
      "wal.append",
      "memtable.insert",
      "read.memtable-active",
      "read.l0",
      "read.done",
    ]);
    // The chain exercises every op prefix the scenario promises.
    const kinds = a.steps.map((s) => s.kind);
    expect(kinds.some((k) => k.startsWith("write") || k === "wal.append")).toBe(true);
    expect(kinds.some((k) => k.startsWith("update."))).toBe(true);
    expect(kinds.some((k) => k.startsWith("read."))).toBe(true);
    expect(kinds.some((k) => k === "flush.complete")).toBe(true);
  });

  it("ends with both versions on disk in different files and the read returns the new one", () => {
    const { steps } = play(updateScenarios[1]);
    const final = steps[steps.length - 1].state;
    expect(final.l0).toHaveLength(2);

    const versions = versionsOf(final, "cherry");
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ home: "s1", seq: 3, value: "dark" }),
        expect.objectContaining({ home: "s4", seq: 6, value: "red" }),
      ]),
    );
    // The stale copy keeps its older seq; the fresh copy's seq is higher.
    const stale = versions.find((v) => v.value === "dark");
    const fresh = versions.find((v) => v.value === "red");
    expect(stale?.seq).toBeLessThan(fresh?.seq ?? 0);

    const read = steps[steps.length - 1];
    expect(read.kind).toBe("read.done");
    expect(read.extras).toMatchObject({
      key: "cherry",
      found: true,
      tombstone: false,
      value: "red",
      seq: 6,
    });
  });

  it("the update step highlights both versions: the new entry and the stale one", () => {
    const { steps } = play(updateScenarios[1]);
    const insert = steps.find((s) => s.kind === "update.memtable.insert");
    expect(insert?.highlights).toEqual(
      expect.arrayContaining([
        { id: "e6", role: "new" },
        { id: "e3", role: "stale" },
      ]),
    );
  });
});
