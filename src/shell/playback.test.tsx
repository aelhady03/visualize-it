// Regression: pressing Play must visibly advance the diagram within a few
// seconds per step (a pacing bug once made steps wait ~8.5s each, so
// playback looked frozen). Exercises the REAL singleton player store, the
// REAL DiagramPane + StepperControls, and a fake module injected through
// mocked discovery.
import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult, Step } from "@core/engine-contract";
import type { VizModule } from "@core/view-contract";
import { usePlayerStore } from "@core/player/store";
import { DiagramPane, StepperControls } from "./index";

interface FakeState {
  n: number;
  config: { done: boolean };
}

function fakeSteps(): Step<FakeState>[] {
  const steps: Step<FakeState>[] = [];
  for (let n = 1; n <= 4; n += 1) {
    steps.push({
      kind: `fake.step-${n}`,
      state: { n, config: { done: n === 4 } },
      narration: "A short narration explaining what just happened and why it matters here.",
    });
  }
  return steps;
}

vi.mock("@core/discovery", () => {
  const FAKE_MODULE: VizModule<FakeState> = {
    contractVersion: 1,
    meta: {
      id: "fake",
      title: "Fake",
      description: "regression fake",
      topics: [],
      difficulty: "beginner",
      category: "Storage Engines",
      order: 0,
    },
    operations: [],
    settings: [],
    scenarios: [{ id: "fake-run", title: "fake", description: "", ops: [{ opId: "go" }] }],
    engine: {
      init: () => ({ n: 0, config: { done: false } }),
      run: (opId, _input, prev): RunResult<FakeState> => {
        if (opId !== "go") return { steps: [], result: prev, error: "unknown op" };
        const steps = fakeSteps();
        return { steps, result: steps.at(-1)!.state };
      },
    },
    Render: ({ state, onAnimationComplete }) => {
      // Complete once per mount, like the real useStepTransition auto-complete.
      useEffect(() => {
        onAnimationComplete();
      }, [onAnimationComplete]);
      return <svg data-testid="fake-diagram" data-n={state.n} />;
    },
  };
  return {
    getModules: () => [],
    loadModule: async () => FAKE_MODULE as unknown as VizModule<unknown>,
  };
});

const store = usePlayerStore;

describe("playback pacing regression", () => {
  beforeEach(() => {
    act(() => store.getState().actions.reset());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("play advances a step within ~1 reading period and re-renders the diagram", async () => {
    render(
      <div>
        <DiagramPane
          module={
            // The pane only needs the module object for init/Render; reuse the
            // same fake via discovery's mocked loadModule shape.
            {
              contractVersion: 1,
              meta: {
                id: "fake",
                title: "Fake",
                description: "",
                topics: [],
                difficulty: "beginner",
                category: "Storage Engines",
                order: 0,
              },
              operations: [],
              settings: [],
              scenarios: [],
              engine: {
                init: () => ({ n: 0, config: { done: false } }),
                run: () => ({ steps: [], result: { n: 0, config: { done: false } } }),
              },
              Render: ({ state, onAnimationComplete }) => {
                useEffect(() => {
                  onAnimationComplete();
                }, [onAnimationComplete]);
                return <svg data-testid="fake-diagram" data-n={(state as FakeState).n} />;
              },
            } as unknown as VizModule<unknown>
          }
        />
        <StepperControls />
      </div>,
    );

    await act(async () => {
      store.getState().actions.startRun("fake", "guided", { scenarioId: "fake-run" });
    });
    await waitFor(() => expect(store.getState().steps.length).toBe(4));
    expect(store.getState().index).toBe(0);
    const svg = () => document.querySelector("svg[data-testid='fake-diagram']");
    expect(svg()?.getAttribute("data-n")).toBe("1");

    vi.useFakeTimers();
    act(() => store.getState().actions.play());

    // Animation completes on mount; the reading timer (<= MAX_READING_MS at
    // 1x) then advances. One full reading period plus slack must move us on.
    act(() => vi.advanceTimersByTime(3200));
    const index = store.getState().index;
    expect(index).toBeGreaterThan(0);

    // The diagram re-rendered with the new step's state.
    expect(Number(svg()?.getAttribute("data-n"))).toBe(index + 1);
  });
});
