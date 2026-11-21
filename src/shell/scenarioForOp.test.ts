import { describe, expect, it } from "vitest";
import type { Operation, Scenario } from "@core/engine-contract";
import { scenarioForOp } from "./scenarioForOp";

const writeOp: Operation = { id: "write", label: "Write", description: "", mode: "both" };
const updateOp: Operation = { id: "update", label: "Update", description: "", mode: "both" };
const bulkOp: Operation = { id: "write-bulk", label: "Bulk", description: "", mode: "sandbox" };

function s(id: string, ops: string[]): Scenario<unknown> {
  return { id, title: id, description: "", ops: ops.map((opId) => ({ opId })) };
}

describe("scenarioForOp", () => {
  const scenarios = [
    s("update-immutability", ["write", "update"]),
    s("write-then-read", ["write", "read"]),
    s("write", ["write"]),
  ];

  it("prefers a scenario whose id equals the op id", () => {
    expect(scenarioForOp(scenarios, writeOp)?.id).toBe("write");
  });

  it("falls back to the scenario whose first op matches (first in array order)", () => {
    const noIdMatch = scenarios.filter((x) => x.id !== "write");
    // update-immutability comes first and also opens with write.
    expect(scenarioForOp(noIdMatch, writeOp)?.id).toBe("update-immutability");
  });

  it("falls back to any scenario containing the op (update opens with write)", () => {
    expect(scenarioForOp(scenarios, updateOp)?.id).toBe("update-immutability");
  });

  it("returns undefined when no scenario mentions the op", () => {
    expect(scenarioForOp(scenarios, bulkOp)).toBeUndefined();
  });
});
