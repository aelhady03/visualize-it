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

describe("update: in-memory replace (key still in the ACTIVE memtable)", () => {
  it("emits exactly update.wal.append + update.memtable.replace — no freeze/flush steps", () => {
    const before = driveWrites(init(), [["apple", "a0"]]);
    const r = run("update", { key: "apple", value: "a1" }, before);
    expect(r.error).toBeUndefined();
    expect(r.steps.map(kindOf)).toEqual(["update.wal.append", "update.memtable.replace"]);
    const s = r.result;
    // the entry is replaced IN PLACE: one entry, the new version
    expect(s.memtables[0].entries).toEqual([{ id: "e2", key: "apple", value: "a1", seq: 2 }]);
    // the WAL keeps BOTH records — every version is durable on its own
    expect(s.wal[0].entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(s.wal[0].entries[0]).toEqual({ id: "e1", key: "apple", value: "a0", seq: 1 });
    expect(s.seq).toBe(3);
    expect(s.metrics.ingestedBytes).toBe(14); // ("apple"+"a0") + ("apple"+"a1")
  });

  it("highlights the new entry and the superseded one as stale", () => {
    const before = driveWrites(init(), [["apple", "a0"]]);
    const r = run("update", { key: "apple", value: "a1" }, before);
    expect(r.steps[0].highlights).toEqual([{ id: "e2", role: "new" }]);
    expect(r.steps[1].highlights).toEqual([
      { id: "e2", role: "new" },
      { id: "e1", role: "stale" },
    ]);
  });

  it("no flush job is created and no SSTable appears", () => {
    const before = driveWrites(init(), [["apple", "a0"]]);
    const s = run("update", { key: "apple", value: "a1" }, before).result;
    expect(s.jobs).toEqual([]);
    expect(s.l0).toEqual([]);
    expect(s.memtables.length).toBe(1);
    expect(s.wal.length).toBe(1);
  });
});

describe("update: flush-forcing (key has left the MemTable)", () => {
  it("runs the write mechanics: insert + jobs.advance + flush.complete; both versions exist", () => {
    const afterSix = driveWrites(init(), SIX); // frozen, flush job at 1/2
    const r = run("update", { key: "cherry", value: "red" }, afterSix);
    expect(r.steps.map(kindOf)).toEqual([
      "update.wal.append",
      "update.memtable.insert",
      "update.jobs.advance",
      "update.flush.complete",
    ]);
    const s = r.result;
    // the OLD version landed on disk untouched
    expect(s.l0.length).toBe(1);
    expect(sstableEntries(s.l0[0]).find((e) => e.key === "cherry")).toEqual({
      id: "e3",
      key: "cherry",
      value: "dark",
      seq: 3,
    });
    // the NEW version sits in the active memtable with a higher seq
    expect(s.memtables.length).toBe(1);
    expect(s.memtables[0].state).toBe("active");
    expect(s.memtables[0].entries).toEqual([{ id: "e7", key: "cherry", value: "red", seq: 7 }]);
  });

  it("emits update.memtable.freeze when the insert hits the cap", () => {
    const afterSix = driveWrites(init(), SIX);
    // grape update completes the first flush; active memtable then holds [grape]
    let state = run("update", { key: "grape", value: "g1" }, afterSix).result;
    // four more writes fill the active memtable to 5 entries (below cap 6)
    state = driveWrites(state, [
      ["k8", "v8"],
      ["k9", "v9"],
      ["k10", "v10"],
      ["k11", "v11"],
    ]);
    const r = run("update", { key: "apple", value: "a2" }, state);
    expect(r.steps.map(kindOf)).toEqual([
      "update.wal.append",
      "update.memtable.insert",
      "update.memtable.freeze",
      "update.jobs.advance",
    ]);
    const s = r.result;
    expect(s.memtables.length).toBe(2);
    expect(s.memtables[0].state).toBe("active");
    expect(s.memtables[1].state).toBe("immutable");
    expect(s.memtables[1].entries.length).toBe(6);
    expect(s.jobs.length).toBe(1);
    expect(s.jobs[0].progress).toBe(1); // flush needs one more op
    expect(s.l0.length).toBe(1); // the first flush landed during the grape update
  });

  it("the old version keeps living in its immutable file until compaction", () => {
    // after the freeze, the previous flush landed s1 with cherry:dark; the
    // new version sits in the memtable that just froze — nothing overwrote s1
    const afterSix = driveWrites(init(), SIX);
    let state = run("update", { key: "grape", value: "g1" }, afterSix).result;
    state = driveWrites(state, [
      ["k8", "v8"],
      ["k9", "v9"],
      ["k10", "v10"],
      ["k11", "v11"],
    ]);
    const r = run("update", { key: "apple", value: "a2" }, state).result;
    const inFile = sstableEntries(r.l0[0]).find((e) => e.key === "apple");
    expect(inFile).toEqual({ id: "e1", key: "apple", value: "red", seq: 1 });
  });
});

describe("update: determinism, JSON-safety, result invariant", () => {
  it("the same update script twice gives deep-equal results", () => {
    const script: Array<{ opId: string; input: Record<string, string> }> = [
      ...SIX.map(([key, value]) => ({ opId: "write", input: { key, value } })),
      { opId: "update", input: { key: "cherry", value: "red" } },
      { opId: "update", input: { key: "cherry", value: "crimson" } },
      { opId: "update", input: { key: "zz", value: "z0" } },
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

  it("every step survives a JSON round-trip and result deep-equals the last step", () => {
    let state = init();
    const ops: Array<{ opId: string; input: Record<string, string> }> = [
      ...SIX.map(([key, value]) => ({ opId: "write", input: { key, value } })),
      { opId: "update", input: { key: "cherry", value: "red" } },
    ];
    for (const op of ops) {
      const r = run(op.opId, op.input, state);
      for (const step of r.steps) {
        expect(JSON.parse(JSON.stringify(step.state))).toEqual(step.state);
      }
      if (r.steps.length > 0) expect(r.result).toEqual(r.steps[r.steps.length - 1].state);
      state = r.result;
    }
  });
});

describe("update: invalid input", () => {
  it("rejects an empty or missing key without emitting steps", () => {
    const prev = init();
    const inputs: Array<OpInput | undefined> = [{}, { key: "" }, undefined];
    for (const input of inputs) {
      const r = run("update", input, prev);
      expect(r.steps).toEqual([]);
      expect(r.result).toEqual(prev);
      expect(r.error).toBeDefined();
    }
  });

  it("coerces non-string values the way the write path does", () => {
    const before = driveWrites(init(), [["apple", "a0"]]);
    const s = run("update", { key: "apple", value: 42 }, before).result;
    expect(s.memtables[0].entries[0].value).toBe("42");
  });
});
