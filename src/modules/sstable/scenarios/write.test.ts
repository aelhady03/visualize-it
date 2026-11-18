import { describe, expect, it } from "vitest";
import type { RunResult, Scenario, Step } from "@core/engine-contract";
import type { EngineState } from "../state";
import { init, run } from "../engine/index";
import { writeScenarios } from "./write";

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

describe("writeScenarios", () => {
  it("exposes write-then-read and maps to the write button (first op is write)", () => {
    expect(writeScenarios).toHaveLength(1);
    const scenario = writeScenarios[0];
    expect(scenario.id).toBe("write-then-read");
    expect(scenario.ops[0].opId).toBe("write");
  });

  it("runs deterministically with the documented kind sequence", () => {
    const scenario = writeScenarios[0];
    const a = play(scenario);
    expect(a).toEqual(play(scenario));
    expect(a.steps.map((s) => s.kind)).toEqual([
      "wal.append",
      "memtable.insert",
      "wal.append",
      "memtable.insert",
      "wal.append",
      "memtable.insert",
      "read.memtable-active",
      "read.done",
      "read.memtable-active",
      "read.done",
    ]);
  });

  it("the read hits the newest write in memory; the absent key reports not found", () => {
    const { results } = play(writeScenarios[0]);
    const readPlum = results[3];
    expect(readPlum.steps[readPlum.steps.length - 1].extras).toMatchObject({
      key: "plum",
      found: true,
      value: "purple",
      seq: 3,
      filesProbed: 0,
      blocksProbed: 0,
    });
    const readMango = results[4];
    expect(readMango.steps[readMango.steps.length - 1].extras).toMatchObject({
      key: "mango",
      found: false,
      filesProbed: 0,
      blocksProbed: 0,
    });
  });
});
