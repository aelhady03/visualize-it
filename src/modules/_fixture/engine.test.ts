import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { init, run } from "./engine";
import type { FixtureState } from "./state";

describe("append", () => {
  it("emits list.stage then list.commit, keeping the result invariant", () => {
    const result = run("append", { value: "apple" }, init());
    expect(result.error).toBeUndefined();
    expect(result.steps.map((step) => step.kind)).toEqual(["list.stage", "list.commit"]);
    expect(result.result).toEqual(result.steps.at(-1)!.state);
    expect(result.result.items.map((item) => item.value)).toEqual(["apple"]);
    expect(result.result.seq).toBe(2);
    expect(result.result.pending).toBeNull();
  });

  it("emits list.cap when the append reaches capacity", () => {
    const result = run("append", { value: "a" }, init({ capacity: 1 }));
    expect(result.steps.map((step) => step.kind)).toEqual(["list.stage", "list.commit", "list.cap"]);
    expect(result.result.items).toHaveLength(1);
  });

  it("refuses a full list with a normal list.full step, not an error", () => {
    const full = run("append", { value: "a" }, init({ capacity: 1 })).result;
    const result = run("append", { value: "b" }, full);
    expect(result.error).toBeUndefined();
    expect(result.steps.map((step) => step.kind)).toEqual(["list.full"]);
    expect(result.result).toEqual(full); // a refusal changes nothing
  });

  it("rejects an empty value as invalid input", () => {
    const result = run("append", { value: "   " }, init());
    expect(result.error).toBeDefined();
    expect(result.steps).toEqual([]);
  });

  it("is deterministic: the same input twice gives identical steps", () => {
    const a = run("append", { value: "x" }, init());
    const b = run("append", { value: "x" }, init());
    expect(a).toEqual(b);
  });
});

describe("clear", () => {
  it("emits reset.stage then reset.drop and empties the list", () => {
    const state = run("append", { value: "a" }, init()).result;
    const result = run("clear", undefined, state);
    expect(result.steps.map((step) => step.kind)).toEqual(["reset.stage", "reset.drop"]);
    expect(result.result.items).toEqual([]);
    expect(result.result.pending).toBeNull();
    // The mark step highlights every item as removed.
    expect(result.steps[0].highlights?.map((highlight) => highlight.role)).toEqual(["removed"]);
  });
});

describe("unknown ops", () => {
  it("are an invalid-input error", () => {
    const result = run("nope", undefined, init());
    expect(result.error).toBeDefined();
    expect(result.steps).toEqual([]);
  });
});

describe("property: any sequence of appends and clears stays well-formed", () => {
  it("never throws and keeps capacity, seq and id invariants", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            op: fc.constantFrom("append", "clear"),
            value: fc.integer({ min: 1, max: 10_000 }).map((n) => `v${n}`),
          }),
          { maxLength: 20 },
        ),
        (ops) => {
          let state: FixtureState = init();
          for (const { op, value } of ops) {
            const result = run(op, { value }, state);
            expect(result.error).toBeUndefined();
            expect(result.result).toEqual(result.steps.at(-1)!.state);
            state = result.result;
          }
          // Invariants after any sequence:
          expect(state.items.length).toBeLessThanOrEqual(state.capacity);
          expect(state.pending).toBeNull();
          const seqs = state.items.map((item) => item.seq);
          expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // strictly increasing
          expect(new Set(state.items.map((item) => item.id)).size).toBe(state.items.length);
          expect(state.seq).toBeGreaterThanOrEqual(seqs.length > 0 ? seqs.at(-1)! + 1 : 1);
        },
      ),
    );
  });
});
