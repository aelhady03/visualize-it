/**
 * LevelsView tests (render/LevelsView.tsx, LEVELED lane).
 *
 * Render-level invariants: mounts for leveled and stcs shapes, exactly one
 * element per layoutId per snapshot (PLAN.md §3.1), and the overlap band
 * appears only while a compaction highlights ≥2 files as "active".
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LevelsView } from "./LevelsView";
import type { EngineState, Entry, SSTable } from "../state";
import { init } from "../engine/index";
import { buildSSTable } from "../engine/jobs";

function ent(id: string, key: string, value: string, seq: number, tombstone?: boolean): Entry {
  return tombstone ? { id, key, value, seq, tombstone: true } : { id, key, value, seq };
}

function mkSst(id: string, entries: Entry[]): SSTable {
  return buildSSTable(id, entries, 2);
}

/** L0 = two overlapping files + one level; tombstones included for the cross marks. */
function sampleState(): EngineState {
  return {
    ...init({ strategy: "leveled" }),
    l0: [
      mkSst("s1", [ent("e1", "apple", "a0", 1), ent("e2", "cherry", "c0", 2)]),
      mkSst("s2", [ent("e3", "banana", "b1", 3), ent("e4", "cherry", "c1", 4, true)]),
    ],
    levels: [[mkSst("l1a", [ent("e5", "date", "d1", 5), ent("e6", "fig", "f0", 6)])]],
  };
}

function mount(state: EngineState, highlights: Array<{ id: string; role: "active" }>) {
  return render(
    <svg>
      <LevelsView
        l0={state.l0}
        levels={state.levels}
        strategy="leveled"
        highlights={highlights}
        speed={1}
        reducedMotion={false}
      />
    </svg>,
  );
}

function layoutIds(container: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of container.querySelectorAll("[data-layout-id]")) {
    const id = el.getAttribute("data-layout-id");
    if (id) out.push(id);
  }
  return out;
}

describe("LevelsView", () => {
  it("mounts for a leveled state and namespaces every entry layoutId", () => {
    const { container } = mount(sampleState(), []);
    expect(container.querySelector('[data-file-id="s1"]')).toBeTruthy();
    expect(container.querySelector('[data-file-id="s2"]')).toBeTruthy();
    expect(container.querySelector('[data-file-id="l1a"]')).toBeTruthy();
    const ids = layoutIds(container);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => id === "sstable:s1:e1")).toBe(true);
    expect(ids.some((id) => id === "sstable:s2:e4")).toBe(true);
    expect(ids.some((id) => id.startsWith("sstable:l1a:"))).toBe(true);
  });

  it("has exactly ONE element per layoutId per snapshot", () => {
    const { container } = mount(sampleState(), [
      { id: "s1", role: "active" },
      { id: "s2", role: "active" },
    ]);
    const ids = layoutIds(container);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) expect(count, `layoutId ${id}`).toBe(1);
  });

  it("draws the overlap band only when ≥2 files are picked as active", () => {
    const one = mount(sampleState(), [{ id: "s1", role: "active" }]);
    expect(one.container.querySelector("[data-overlap-band]")).toBeFalsy();
    one.unmount();

    const two = mount(sampleState(), [
      { id: "s1", role: "active" },
      { id: "s2", role: "active" },
    ]);
    expect(two.container.querySelector("[data-overlap-band]")).toBeTruthy();
    two.unmount();

    // a level file joining the pick group still counts as ≥2 active files
    const mixed = mount(sampleState(), [
      { id: "s2", role: "active" },
      { id: "l1a", role: "active" },
    ]);
    expect(mixed.container.querySelector("[data-overlap-band]")).toBeFalsy(); // ranges do not intersect
    mixed.unmount();
  });

  it("mounts for an stcs state (levels empty, unordered runs) and for an empty state", () => {
    const stcs = { ...sampleState(), levels: [], config: { ...sampleState().config, strategy: "stcs" } };
    const a = render(
      <svg>
        <LevelsView
          l0={stcs.l0}
          levels={stcs.levels}
          strategy="stcs"
          highlights={[]}
          speed={1}
          reducedMotion={true}
        />
      </svg>,
    );
    expect(a.container.querySelector('[data-file-id="s1"]')).toBeTruthy();
    a.unmount();

    const empty = init({ strategy: "leveled" });
    const b = render(
      <svg>
        <LevelsView
          l0={empty.l0}
          levels={empty.levels}
          strategy="leveled"
          highlights={[]}
          speed={1}
          reducedMotion={true}
        />
      </svg>,
    );
    expect(b.container.textContent).toContain("No SSTables yet");
    b.unmount();
  });
});
