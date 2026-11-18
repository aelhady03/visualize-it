import { describe, expect, it } from "vitest";
import type { OpInput } from "@core/engine-contract";
import { init, run } from "./engine/index";
import type { EngineState } from "./state";
import { sstableEntries } from "./lib/derive";

const kindOf = (s: { kind: string }) => s.kind;

/** Six distinct keys — the 6th write freezes the MemTable (cap 6). */
const SIX: Array<[string, string]> = [
  ["apple", "red"],
  ["banana", "yellow"],
  ["cherry", "dark"],
  ["date", "brown"],
  ["elderberry", "purple"],
  ["fig", "green"],
];

function driveWrites(initial: EngineState, pairs: Array<[string, string]>) {
  let state = initial;
  for (const [key, value] of pairs) state = run("write", { key, value }, state).result;
  return state;
}

describe("delete: tombstone entry shape", () => {
  it("writes a tombstone through WAL + memtable with delete. kinds", () => {
    const r = run("delete", { key: "apple" }, init());
    expect(r.error).toBeUndefined();
    expect(r.steps.map(kindOf)).toEqual(["delete.wal.append", "delete.memtable.insert"]);
    const s = r.result;
    expect(s.memtables[0].entries).toEqual([
      { id: "e1", key: "apple", value: "", seq: 1, tombstone: true },
    ]);
    expect(s.wal[0].entries).toEqual([
      { id: "e1", key: "apple", value: "", seq: 1, tombstone: true },
    ]);
    expect(s.seq).toBe(2);
    expect(s.metrics.ingestedBytes).toBe(5); // just the key, no value
  });

  it("replaces an in-memory key with its tombstone (no growth, no freeze)", () => {
    const before = driveWrites(init(), [
      ["apple", "a0"],
      ["banana", "b1"],
    ]);
    const r = run("delete", { key: "apple" }, before);
    expect(r.steps.map(kindOf)).toEqual(["delete.wal.append", "delete.memtable.insert"]);
    const s = r.result;
    expect(s.memtables[0].entries).toEqual([
      { id: "e3", key: "apple", value: "", seq: 3, tombstone: true },
      { id: "e2", key: "banana", value: "b1", seq: 2 },
    ]);
    // the WAL keeps every record: the value AND the tombstone that replaced it
    expect(s.wal[0].entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(s.jobs).toEqual([]);
    expect(s.l0).toEqual([]);
  });
});

describe("delete: the tombstone travels the normal write path", () => {
  it("old value lands in an sstable while the tombstone sits in the active memtable", () => {
    const afterSix = driveWrites(init(), SIX); // frozen, flush job at 1/2
    const r = run("delete", { key: "cherry" }, afterSix);
    expect(r.steps.map(kindOf)).toEqual([
      "delete.wal.append",
      "delete.memtable.insert",
      "delete.jobs.advance",
      "delete.flush.complete",
    ]);
    const s = r.result;
    // the OLD value reached disk untouched
    expect(s.l0.length).toBe(1);
    expect(sstableEntries(s.l0[0]).find((e) => e.key === "cherry")).toEqual({
      id: "e3",
      key: "cherry",
      value: "dark",
      seq: 3,
    });
    // the tombstone shadows it from memory with a higher seq
    expect(s.memtables[0].entries).toEqual([
      { id: "e7", key: "cherry", value: "", seq: 7, tombstone: true },
    ]);
  });

  it("the tombstone itself reaches disk through a later flush, next to the old value", () => {
    const afterSix = driveWrites(init(), SIX);
    let state = run("delete", { key: "cherry" }, afterSix).result; // tombstone in active mt
    // five writes fill the active memtable (tombstone + 5 = cap 6 → freeze)
    state = driveWrites(state, [
      ["k8", "v8"],
      ["k9", "v9"],
      ["k10", "v10"],
      ["k11", "v11"],
      ["k12", "v12"],
    ]);
    expect(state.jobs.length).toBe(1); // flush of the tombstone pending
    // one more write completes it
    state = run("write", { key: "k13", value: "v13" }, state).result;
    expect(state.l0.length).toBe(2);
    const old = sstableEntries(state.l0[0]).find((e) => e.key === "cherry");
    expect(old).toEqual({ id: "e3", key: "cherry", value: "dark", seq: 3 });
    const tomb = sstableEntries(state.l0[1]).find((e) => e.key === "cherry");
    expect(tomb).toEqual({ id: "e7", key: "cherry", value: "", seq: 7, tombstone: true });
  });

  it("emits delete.memtable.freeze when the tombstone insert hits the cap", () => {
    // active memtable at 5 entries; deleting a NEW key grows it to 6 → freeze
    const afterSix = driveWrites(init(), SIX);
    let state = run("write", { key: "grape", value: "g0" }, afterSix).result; // flush lands
    state = driveWrites(state, [
      ["k8", "v8"],
      ["k9", "v9"],
      ["k10", "v10"],
      ["k11", "v11"],
    ]);
    const r = run("delete", { key: "zz" }, state);
    expect(r.steps.map(kindOf)).toEqual([
      "delete.wal.append",
      "delete.memtable.insert",
      "delete.memtable.freeze",
      "delete.jobs.advance",
    ]);
    expect(r.result.memtables[1].state).toBe("immutable");
    expect(r.result.memtables[1].entries[5]).toEqual({
      id: expect.any(String),
      key: "zz",
      value: "",
      seq: expect.any(Number),
      tombstone: true,
    });
  });
});

describe("delete: determinism and invalid input", () => {
  it("the same delete script twice gives deep-equal results", () => {
    const script: Array<{ opId: string; input: Record<string, string> }> = [
      ...SIX.map(([key, value]) => ({ opId: "write", input: { key, value } })),
      { opId: "delete", input: { key: "cherry" } },
      { opId: "delete", input: { key: "apple" } },
    ];
    const drive = () => {
      const results = [];
      let state = init();
      for (const op of script) {
        const r = run(op.opId, op.input, state);
        results.push(r);
        state = r.result;
      }
      return { results, state };
    };
    expect(drive()).toEqual(drive());
  });

  it("rejects an empty or missing key without emitting steps", () => {
    const prev = init();
    const inputs: Array<OpInput | undefined> = [{}, { key: "" }, undefined];
    for (const input of inputs) {
      const r = run("delete", input, prev);
      expect(r.steps).toEqual([]);
      expect(r.result).toEqual(prev);
      expect(r.error).toBeDefined();
    }
  });
});
