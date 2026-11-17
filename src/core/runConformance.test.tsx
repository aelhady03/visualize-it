import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { runConformance } from "./runConformance";
import type { OpInput, RunResult } from "./engine-contract";
import type { RenderProps, VizModule } from "./view-contract";

interface FakeState {
  count: number;
}

interface MakeModuleOptions {
  id?: string;
  run?: (opId: string, input: OpInput | undefined, prev: FakeState) => RunResult<FakeState>;
  operations?: VizModule<FakeState>["operations"];
  scenarios?: VizModule<FakeState>["scenarios"];
  Render?: VizModule<FakeState>["Render"];
}

function GoodRender({ state, onAnimationComplete }: RenderProps<FakeState>) {
  useEffect(() => {
    onAnimationComplete();
  });
  return <svg data-testid="fake-render" data-count={state.count} />;
}

/** A well-formed tiny module: 2 steps per op, deterministic, JSON-safe. */
function makeModule(options: MakeModuleOptions = {}): VizModule<FakeState> {
  const defaultRun = (opId: string, input: OpInput | undefined, prev: FakeState) => {
    const n = Number(input?.n ?? 1);
    const start = { count: prev.count };
    const done = { count: prev.count + n };
    return {
      steps: [
        { kind: `${opId}.begin`, state: start, narration: "About to add." },
        { kind: `${opId}.done`, state: done, narration: "Added the increment." },
      ],
      result: done,
    };
  };
  return {
    contractVersion: 1,
    meta: {
      id: options.id ?? "fake",
      title: "Fake",
      description: "fake",
      topics: ["test"],
      difficulty: "beginner",
      category: "Test",
      order: 1,
    },
    operations:
      options.operations ??
      ([
        {
          id: "inc",
          label: "Increment",
          description: "increment",
          mode: "both",
          inputSchema: [{ id: "n", label: "N", type: "number", default: 1 }],
        },
      ] satisfies VizModule<FakeState>["operations"]),
    settings: [],
    scenarios:
      options.scenarios ??
      ([
        { id: "s1", title: "S1", description: "S1", ops: [{ opId: "inc", input: { n: 1 } }] },
        {
          id: "s2",
          title: "S2",
          description: "S2 (seeded)",
          seedState: { count: 5 },
          ops: [{ opId: "inc", input: { n: 2 } }],
        },
      ] satisfies VizModule<FakeState>["scenarios"]),
    engine: { init: () => ({ count: 0 }), run: options.run ?? defaultRun },
    Render: options.Render ?? GoodRender,
  };
}

describe("runConformance", () => {
  it("passes a well-formed module", async () => {
    const report = await runConformance(makeModule());
    expect(report.moduleId).toBe("fake");
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("fails determinism when a module is not deterministic", async () => {
    let calls = 0;
    const report = await runConformance(
      makeModule({
        run: (_opId, _input, prev) => {
          calls += 1;
          const state = { count: prev.count + calls };
          return {
            steps: [{ kind: "inc.begin", state, narration: "n." }],
            result: state,
          };
        },
      }),
    );
    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.includes("determinism"))).toBe(true);
    expect(report.failures.some((failure) => failure.includes("fake"))).toBe(true);
  });

  it("fails the json round-trip when a state relies on undefined", async () => {
    const report = await runConformance(
      makeModule({
        run: (_opId, _input, prev) => {
          const state = { count: prev.count + 1, arr: [1, undefined] };
          return {
            steps: [{ kind: "inc.begin", state, narration: "n." }],
            result: state,
          };
        },
      }),
    );
    expect(report.failures.some((failure) => failure.includes("json-roundtrip"))).toBe(true);
  });

  it("fails narration+kind for empty values", async () => {
    const report = await runConformance(
      makeModule({
        run: (_opId, _input, prev) => {
          const state = { count: prev.count + 1 };
          return {
            steps: [{ kind: "", state, narration: "   " }],
            result: state,
          };
        },
      }),
    );
    expect(report.failures.some((failure) => failure.includes("narration+kind") && failure.includes("kind"))).toBe(true);
    expect(report.failures.some((failure) => failure.includes("narration+kind") && failure.includes("narration"))).toBe(true);
  });

  it("fails the result invariant when result diverges from the last step state", async () => {
    const report = await runConformance(
      makeModule({
        run: (_opId, _input, prev) => {
          const state = { count: prev.count + 1 };
          return {
            steps: [{ kind: "inc.begin", state, narration: "n." }],
            result: { count: state.count + 99 },
          };
        },
      }),
    );
    expect(report.failures.some((failure) => failure.includes("result-invariant"))).toBe(true);
  });

  it("fails scenario-run when an op throws", async () => {
    const report = await runConformance(
      makeModule({
        run: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(report.failures.some((failure) => failure.includes("scenario-run"))).toBe(true);
  });

  it("fails sandbox-inputSchema when a sandbox op declares none", async () => {
    const report = await runConformance(
      makeModule({
        operations: [{ id: "inc", label: "Increment", description: "inc", mode: "sandbox" }],
      }),
    );
    expect(report.failures.some((failure) => failure.includes("sandbox-inputSchema"))).toBe(true);
  });

  it("fails render-mount when Render throws", async () => {
    const report = await runConformance(
      makeModule({
        Render: () => {
          throw new Error("render boom");
        },
      }),
    );
    expect(report.failures.some((failure) => failure.includes("render-mount"))).toBe(true);
  });

  it("fails render.onAnimationComplete when the callback never fires", async () => {
    const report = await runConformance(
      makeModule({
        Render: () => <svg data-testid="silent" />,
      }),
    );
    expect(report.failures.some((failure) => failure.includes("render.onAnimationComplete"))).toBe(true);
  });
});
