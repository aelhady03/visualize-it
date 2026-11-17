import { describe, expect, it } from "vitest";
import {
  getModules,
  loadModule,
  sortSummaries,
  validateModuleSets,
  type ModuleSummary,
} from "./discovery";

function summary(category: string, order: number): ModuleSummary {
  return {
    meta: {
      id: `${category}-${order}`,
      title: `${category} ${order}`,
      description: "d",
      topics: [],
      difficulty: "beginner",
      category,
      order,
    },
    operations: [],
    settings: [],
  };
}

describe("getModules", () => {
  it("discovers the fixture module through the eager meta glob", () => {
    const modules = getModules();
    expect(Array.isArray(modules)).toBe(true);
    const fixture = modules.find((candidate) => candidate.meta.id === "_fixture");
    expect(fixture).toBeDefined();
    expect(fixture!.operations.length).toBeGreaterThan(0);
    expect(fixture!.settings.length).toBeGreaterThan(0);
  });
});

describe("sortSummaries", () => {
  it("orders by category, then by order within a category", () => {
    const sorted = sortSummaries([summary("B", 0), summary("A", 2), summary("A", 1), summary("A", 10)]);
    expect(sorted.map((entry) => entry.meta.id)).toEqual(["A-1", "A-2", "A-10", "B-0"]);
  });

  it("tolerates an empty repository", () => {
    expect(sortSummaries([])).toEqual([]);
  });
});

describe("loadModule", () => {
  it("lazy-loads the full module and caches the promise", async () => {
    const first = loadModule("_fixture");
    expect(first).toBeInstanceOf(Promise);
    const module = await first;
    expect(module.contractVersion).toBe(1);
    expect(module.meta.id).toBe("_fixture");
    expect(typeof module.engine.run).toBe("function");
    expect(module.Render).toBeDefined();
    await expect(loadModule("_fixture")).resolves.toBe(module);
  });

  it("rejects unknown module ids", async () => {
    await expect(loadModule("missing-module")).rejects.toThrow(/missing-module/);
  });
});

describe("validateModuleSets", () => {
  it("accepts consistent folders and tolerates zero modules", () => {
    expect(() => validateModuleSets(new Set(), new Set())).not.toThrow();
    expect(() => validateModuleSets(new Set(["a", "b"]), new Set(["a", "b"]))).not.toThrow();
  });

  it("throws when a folder has only one of the two discovery files", () => {
    expect(() => validateModuleSets(new Set(["a"]), new Set())).toThrow(/a.*index\.ts/);
    expect(() => validateModuleSets(new Set(), new Set(["b"]))).toThrow(/b.*meta\.ts/);
  });
});
