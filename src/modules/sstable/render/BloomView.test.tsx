import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { Highlight } from "@core/engine-contract";
import type { SSTable } from "../state";
import { hashPositions, maybe } from "../lib/bloom";
import { buildSSTable } from "../engine/jobs";
import { BloomView } from "./BloomView";

// NOTE: BloomView receives NO onAnimationComplete in its frozen props — the
// region structurally cannot double-complete the player; render/index.tsx
// owns completion.

const SIX_KEYS = ["apple", "banana", "cherry", "date", "elderberry", "fig"];

function sixFile(id: string): SSTable {
  return buildSSTable(
    id,
    SIX_KEYS.map((key, i) => ({ id: `e${i + 1}`, key, value: `v${i}`, seq: i + 1 })),
    2,
  );
}

const readkey = (key: string): Highlight => ({ id: `readkey:${key}`, role: "active" });

function renderBloom(
  highlights: Highlight[],
  l0: SSTable[] = [sixFile("s1")],
  reducedMotion = false,
) {
  return render(
    <BloomView
      l0={l0}
      levels={[]}
      highlights={highlights}
      speed={1}
      reducedMotion={reducedMotion}
    />,
  );
}

describe("BloomView", () => {
  it("renders nothing for non-read steps (no readkey highlight)", () => {
    const { container } = renderBloom([{ id: "e1", role: "hit" }]);
    expect(container.querySelectorAll("rect")).toHaveLength(0);
  });

  it("renders nothing while only memtables are probed (readkey but no file)", () => {
    const { container } = renderBloom([readkey("cherry")]);
    expect(container.querySelectorAll("rect")).toHaveLength(0);
  });

  it("shows the probed file's bloom with the hash positions lit (false positive)", () => {
    const { container } = renderBloom([readkey("blueberry"), { id: "s1", role: "miss" }]);
    const cells = container.querySelectorAll("rect");
    expect(cells).toHaveLength(16);
    const positions = hashPositions("blueberry");
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      expect(cells[p].getAttribute("stroke")).toBe("var(--viz-miss)");
      expect(cells[p].getAttribute("stroke-width")).toBe("1.75");
    }
    expect(container.textContent).toContain("false positive");
    expect(container.querySelector('[data-layout-id="bloom:s1"]')).toBeTruthy();
    expect(container.querySelector('[data-layout-id="bloom:s1:b7"]')).toBeTruthy();
  });

  it("colors the hash cells with the hit token on a hit", () => {
    const { container } = renderBloom([readkey("cherry"), { id: "s1", role: "hit" }]);
    const cells = container.querySelectorAll("rect");
    expect(cells).toHaveLength(16);
    for (const p of hashPositions("cherry")) {
      expect(cells[p].getAttribute("stroke")).toBe("var(--viz-hit)");
    }
    expect(container.textContent).toContain("hit");
  });

  it("derives the 'definitely not' verdict when the filter misses", () => {
    const file = buildSSTable(
      "sN",
      [
        { id: "e1", key: "apple", value: "a", seq: 1 },
        { id: "e2", key: "banana", value: "b", seq: 2 },
      ],
      2,
    );
    expect(maybe(file.bloom, "apricot")).toBe(false); // premise, deterministic
    const { container } = renderBloom([readkey("apricot"), { id: "sN", role: "miss" }], [file]);
    expect(container.textContent).toContain("definitely not");
  });

  it("labels each probed file with its id, one row per file", () => {
    const other = sixFile("s2");
    const { container } = renderBloom(
      [readkey("cherry"), { id: "s1", role: "hit" }, { id: "s2", role: "miss" }],
      [sixFile("s1"), other],
    );
    expect(container.textContent).toContain("s1");
    expect(container.textContent).toContain("s2");
    expect(container.querySelectorAll("rect")).toHaveLength(32); // 2 files × 16 bits
  });

  it("mounts with reducedMotion true and false", () => {
    expect(renderBloom([readkey("cherry"), { id: "s1", role: "hit" }], undefined, true).container).toBeTruthy();
    expect(renderBloom([readkey("cherry"), { id: "s1", role: "hit" }], undefined, false).container).toBeTruthy();
  });
});
