import { describe, expect, it } from "vitest";
import { runConformance } from "@core/runConformance";
import type { OpInput, RunResult } from "@core/engine-contract";
import fixtureModule from "./index";
import type { FixtureState } from "./state";

describe("_fixture module conformance", () => {
  it("passes all 7 conformance checks", async () => {
    const report = await runConformance(fixtureModule);
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("reports a broken module (empty narration) with the check and module name", async () => {
    const broken = {
      ...fixtureModule,
      engine: {
        ...fixtureModule.engine,
        run: (opId: string, input: OpInput | undefined, prev: FixtureState): RunResult<FixtureState> => {
          const result = fixtureModule.engine.run(opId, input, prev);
          const steps = result.steps.map((step) =>
            step.kind === "list.stage" ? { ...step, narration: "" } : step,
          );
          return { ...result, steps };
        },
      },
    };
    const report = await runConformance(broken);
    expect(report.passed).toBe(false);
    expect(
      report.failures.some(
        (failure) => failure.includes("narration") && failure.includes("_fixture"),
      ),
    ).toBe(true);
  });
});
