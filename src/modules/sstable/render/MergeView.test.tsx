/**
 * MergeView render tests (STCS lane, PLAN.md §8 rendering conventions).
 *
 * Asserts structure and the one-element-per-layoutId rule, never narration
 * wording. The region receives the FROZEN MergeViewProps from render/regions.ts
 * and must never call onAnimationComplete (it is not part of its props).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MergeView } from "./MergeView";
import { init, run } from "../engine/index";

/** Drive the guided scenario's write phase + one compact → real in-flight job. */
function inFlightState() {
  const writes = [
    { key: "k1", value: "v1" },
    { key: "k2", value: "v2" },
    { key: "k3", value: "v3" },
    { key: "k4", value: "v4" },
    { key: "k5", value: "v5" },
    { key: "k6", value: "v6" },
    { key: "k1", value: "v7" }, // stale v1 (in s1) will drop
    { key: "k7", value: "v8" },
    { key: "k8", value: "v9" },
    { key: "k9", value: "v10" },
    { key: "k2", value: "v11" }, // stale v2 (in s1) will drop
    { key: "k10", value: "v12" },
    { key: "k11", value: "v13" },
  ];
  let state = init({ memtableCap: 3 });
  for (const w of writes) state = run("write", w, state).result;
  const started = run("compact", {}, state);
  return started.result; // L0 = [s1, s4, s7, s10], job j14 at 0/4
}

describe("MergeView", () => {
  it("renders the idle label when no compaction job is in flight", () => {
    const state = init();
    const { container } = render(
      <svg>
        <MergeView
          jobs={state.jobs}
          l0={state.l0}
          levels={state.levels}
          highlights={[]}
          speed={1}
          reducedMotion={true}
        />
      </svg>,
    );
    expect(container.textContent).toContain("size-tiered merge — idle");
  });

  it("shows the job header, inputs, merge counts and dropped entries", () => {
    const state = inFlightState();
    const job = state.jobs[0];
    const { container } = render(
      <svg>
        <MergeView
          jobs={state.jobs}
          l0={state.l0}
          levels={state.levels}
          highlights={[]}
          speed={1}
          reducedMotion={true}
        />
      </svg>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(`merge ${job.id}`);
    expect(text).toContain(`${job.progress}/${job.total} units`);
    expect(text).toContain("from s1 + s4 + s7 + s10");
    expect(text).toContain("10 entries merge");
    expect(text).toContain("2 drop"); // stale k1v1 + k2v2
    // every input file id is labeled
    for (const id of job.inputs) expect(text).toContain(id);
    // the dropped entries still render (dimmed) with their entity ids
    expect(container.querySelector('[data-entity-id="e1"]')).toBeTruthy(); // k1v1
    expect(container.querySelector('[data-entity-id="e2"]')).toBeTruthy(); // k2v2
  });

  it("marks dropped stale entries with a strike and keeps exactly one element per layoutId", () => {
    const state = inFlightState();
    const { container } = render(
      <svg>
        <MergeView
          jobs={state.jobs}
          l0={state.l0}
          levels={state.levels}
          highlights={[]}
          speed={1}
          reducedMotion={false}
        />
      </svg>,
    );
    // the two stale cells get a dashed strike line; survivors get none
    const strikes = container.querySelectorAll('line[stroke-dasharray="3 3"]');
    expect(strikes.length).toBe(2);
    // one element per layoutId per snapshot (PLAN.md §3.1)
    const layoutIds = Array.from(container.querySelectorAll("[data-layout-id]"))
      .map((el) => el.getAttribute("data-layout-id"))
      .filter((id): id is string => id !== null && id !== "");
    expect(layoutIds).toEqual([`merge:${state.jobs[0].id}`]); // the job header box only
    expect(new Set(layoutIds).size).toBe(layoutIds.length);
  });

  it("stays mountable for every snapshot of the merge and returns to idle after completion", () => {
    // MergeViewProps carries no onAnimationComplete — completion belongs to
    // render/index.tsx — so this proves the region stays mountable across
    // the merge lifecycle (in flight → completed → idle).
    let state = init({ memtableCap: 3 });
    const writes = [
      { key: "k1", value: "v1" },
      { key: "k2", value: "v2" },
      { key: "k3", value: "v3" },
      { key: "k4", value: "v4" },
      { key: "k5", value: "v5" },
      { key: "k6", value: "v6" },
      { key: "k1", value: "v7" },
      { key: "k7", value: "v8" },
      { key: "k8", value: "v9" },
      { key: "k9", value: "v10" },
      { key: "k2", value: "v11" },
      { key: "k10", value: "v12" },
      { key: "k11", value: "v13" },
    ];
    for (const w of writes) state = run("write", w, state).result;
    for (let i = 0; i < 5; i++) state = run("compact", {}, state).result;
    expect(state.jobs).toEqual([]);
    expect(state.l0).toHaveLength(1);
    const { container } = render(
      <svg>
        <MergeView
          jobs={state.jobs}
          l0={state.l0}
          levels={state.levels}
          highlights={[]}
          speed={1}
          reducedMotion={false}
        />
      </svg>,
    );
    expect(container.textContent).toContain("idle");
  });
});
