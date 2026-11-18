import { describe, expect, it } from "vitest";
import type { RunResult, Scenario, Step } from "@core/engine-contract";
import type { EngineState } from "../state";
import { isEngineState } from "../state";
import { init, run } from "../engine/index";
import { maybe } from "../lib/bloom";
import { sstableEntries } from "../lib/derive";
import { readScenarios } from "./read";

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

describe("readScenarios", () => {
  it("exposes bloom-false-positive and maps to the read button (first op is read)", () => {
    expect(readScenarios).toHaveLength(1);
    const scenario = readScenarios[0];
    expect(scenario.id).toBe("bloom-false-positive");
    expect(scenario.ops[0].opId).toBe("read");
    expect(scenario.seedState).toBeDefined();
    expect(isEngineState(scenario.seedState)).toBe(true);
  });

  it("the seed state is a real flushed engine state (one file + one active memtable)", () => {
    const seed = readScenarios[0].seedState as EngineState;
    expect(seed.l0).toHaveLength(1);
    expect(seed.memtables).toHaveLength(1);
    expect(seed.memtables[0].state).toBe("active");
    expect(seed.memtables[0].entries.map((e) => e.key)).toEqual(["honeydew"]);
    expect(seed.jobs).toHaveLength(0);
    expect(seed.config.strategy).toBe("stcs");
  });

  it("runs deterministically with the documented kind sequence", () => {
    const scenario = readScenarios[0];
    const a = play(scenario);
    expect(a).toEqual(play(scenario));
    expect(a.steps.map((s) => s.kind)).toEqual([
      "read.memtable-active",
      "read.bloom-false-positive",
      "read.done",
      "read.memtable-active",
      "read.l0",
      "read.done",
    ]);
  });

  it("the false-positive step really is one: bloom says maybe, the key is absent", () => {
    const { steps } = play(readScenarios[0]);
    const fp = steps[1];
    expect(fp.kind).toBe("read.bloom-false-positive");
    const file = fp.state.l0[0];
    expect(maybe(file.bloom, "blueberry")).toBe(true);
    expect(sstableEntries(file).some((e) => e.key === "blueberry")).toBe(false);

    const firstRead = steps[2];
    expect(firstRead.extras).toMatchObject({
      key: "blueberry",
      found: false,
      filesProbed: 1,
      blocksProbed: 1,
    });
    const secondRead = steps[5];
    expect(secondRead.extras).toMatchObject({
      key: "cherry",
      found: true,
      value: "c0",
      seq: 3,
      filesProbed: 1,
      blocksProbed: 1,
    });
  });
});
