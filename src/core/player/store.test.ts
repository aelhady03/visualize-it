import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpInput, RunResult, Step } from "../engine-contract";
import type { VizModule } from "../view-contract";
import { loadModule } from "../discovery";
import { createPlayerStore, deriveChapters, MAX_SPEED, MIN_SPEED } from "./store";

/** Flush microtask chains (promise-based startRun/undo settle with this). */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

function kind(k: string): Step<unknown> {
  return { kind: k, state: {}, narration: "n" };
}

describe("deriveChapters", () => {
  it("groups consecutive equal kind prefixes into one chapter", () => {
    expect(deriveChapters([])).toEqual([]);
    expect(
      deriveChapters([kind("wal.append"), kind("wal.marker"), kind("flush.build"), kind("read.l0")]),
    ).toEqual([
      { start: 0, end: 1, label: "wal" },
      { start: 2, end: 2, label: "flush" },
      { start: 3, end: 3, label: "read" },
    ]);
  });

  it("treats a kind without a dot as its own prefix", () => {
    expect(deriveChapters([kind("recover"), kind("recover"), kind("read.l0")])).toEqual([
      { start: 0, end: 1, label: "recover" },
      { start: 2, end: 2, label: "read" },
    ]);
  });
});

// --- fake modules for isolation and autoplay tests ----------------------------

interface FakeState {
  count: number;
}

function makeSandboxFake(id: string): VizModule<unknown> {
  return {
    contractVersion: 1,
    meta: {
      id,
      title: id,
      description: "test",
      topics: ["test"],
      difficulty: "beginner",
      category: "Test",
      order: 1,
    },
    operations: [],
    settings: [],
    scenarios: [],
    engine: {
      init: () => ({ count: 0 }),
      run: (_opId: string, input: OpInput | undefined, prev: unknown): RunResult<unknown> => {
        const state = prev as FakeState;
        const next = { count: state.count + Number(input?.n ?? 1) };
        return {
          steps: [
            { kind: "op.begin", state: { count: state.count }, narration: "begin." },
            { kind: "op.done", state: next, narration: "done." },
          ],
          result: next,
        };
      },
    },
    Render: () => null,
  };
}

/** Guided fake: one scenario → 3 steps, chapters wal / flush / read. */
function makeGuidedFake(): VizModule<unknown> {
  return {
    contractVersion: 1,
    meta: {
      id: "guided-fake",
      title: "Guided",
      description: "test",
      topics: ["test"],
      difficulty: "beginner",
      category: "Test",
      order: 2,
    },
    operations: [],
    settings: [],
    scenarios: [
      {
        id: "lesson",
        title: "Lesson",
        description: "lesson",
        ops: [{ opId: "start" }],
      },
    ],
    engine: {
      init: () => ({ n: 0 }),
      run: (): RunResult<unknown> => ({
        steps: [
          { kind: "wal.append", state: { n: 1 }, narration: "first sentence" },
          { kind: "flush.start", state: { n: 2 }, narration: "second sentence" },
          { kind: "read.l0", state: { n: 3 }, narration: "third sentence" },
        ],
        result: { n: 3 },
      }),
    },
    Render: () => null,
  };
}

// --- real fixture: timeline, chapters, sandbox, undo, reset -------------------

describe("player store with the real _fixture module", () => {
  it("concatenates a guided scenario into ONE timeline with chapter markers", async () => {
    const store = createPlayerStore(loadModule);
    store.getState().actions.startRun("_fixture", "guided", { scenarioId: "append-then-clear" });
    await vi.waitFor(() => expect(store.getState().steps.length).toBe(6));

    const state = store.getState();
    expect(state.moduleId).toBe("_fixture");
    expect(state.mode).toBe("guided");
    expect(state.run).toEqual({ scenarioId: "append-then-clear" });
    expect(state.steps.map((step) => step.kind)).toEqual([
      "list.stage",
      "list.commit",
      "list.stage",
      "list.commit",
      "reset.stage",
      "reset.drop",
    ]);
    // Operation boundaries (the two appends) share the "list" prefix; clear is "reset".
    expect(state.chapters).toEqual([
      { start: 0, end: 3, label: "list" },
      { start: 4, end: 5, label: "reset" },
    ]);
    expect(state.index).toBe(0); // guided starts at the first step (manual stepping)
    expect(state.historyLength).toBe(0);
  });

  it("sandbox runs commit immediately, land on the result, and count history", async () => {
    const store = createPlayerStore(loadModule);
    const first = store.getState().actions;
    first.startRun("_fixture", "sandbox", { opId: "append", input: { value: "a" } });
    await vi.waitFor(() => expect(store.getState().steps.length).toBeGreaterThan(0));

    let state = store.getState();
    expect(state.index).toBe(state.steps.length - 1); // view lands on the committed result
    expect(state.historyLength).toBe(1);
    expect((state.steps.at(-1)!.state as { items: unknown[] }).items).toHaveLength(1);

    state.actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "b" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(2));
    state = store.getState();
    expect((state.steps.at(-1)!.state as { items: unknown[] }).items).toHaveLength(2);
  });

  it("undo pops committed sandbox runs back to init", async () => {
    const store = createPlayerStore(loadModule);
    const actions = store.getState().actions;
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "a" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "b" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(2));

    actions.undo();
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));
    let state = store.getState();
    expect((state.steps.at(-1)!.state as { items: unknown[] }).items).toHaveLength(1);

    actions.undo();
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(0));
    state = store.getState();
    expect(state.steps).toEqual([]);
    expect(state.chapters).toEqual([]);
    expect(state.index).toBe(-1);
    expect(state.run).toBeNull();

    actions.undo(); // empty history: no-op
    await settle();
    expect(store.getState().historyLength).toBe(0);
  });

  it("reset returns to init: history and timeline cleared", async () => {
    const store = createPlayerStore(loadModule);
    const actions = store.getState().actions;
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "a" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));

    actions.reset();
    expect(store.getState()).toMatchObject({
      moduleId: "_fixture",
      run: null,
      steps: [],
      chapters: [],
      index: -1,
      playing: false,
      historyLength: 0,
    });

    // After reset a fresh append starts from the initial state again.
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "z" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));
    const state = store.getState();
    expect((state.steps.at(-1)!.state as { items: unknown[] }).items).toHaveLength(1);
    expect((state.steps.at(-1)!.state as { items: Array<{ value: string }> }).items[0].value).toBe("z");
  });

  it("rejects an invalid sandbox input without committing", async () => {
    const store = createPlayerStore(loadModule);
    store.getState().actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "   " } });
    await settle();
    const state = store.getState();
    expect(state.steps).toEqual([]);
    expect(state.historyLength).toBe(0);
    expect(state.index).toBe(-1);
  });
});

// --- per-module isolation ------------------------------------------------------

describe("per-module isolation", () => {
  it("keeps each module's sandbox history across switches", async () => {
    const store = createPlayerStore((id) => Promise.resolve(makeSandboxFake(id)));
    const actions = store.getState().actions;

    actions.startRun("alpha", "sandbox", { opId: "inc", input: { n: 2 } });
    await settle();
    expect(store.getState().historyLength).toBe(1);
    expect(
      (store.getState().steps.at(-1)!.state as FakeState).count,
    ).toBe(2);

    actions.startRun("beta", "sandbox", { opId: "inc", input: { n: 5 } });
    await settle();
    let state = store.getState();
    expect(state.moduleId).toBe("beta");
    expect(state.historyLength).toBe(1); // beta has its own history
    expect((state.steps.at(-1)!.state as FakeState).count).toBe(5);

    // Back to alpha: its committed state (count 2) survived the switch.
    actions.startRun("alpha", "sandbox", { opId: "inc", input: { n: 10 } });
    await settle();
    state = store.getState();
    expect(state.moduleId).toBe("alpha");
    expect(state.historyLength).toBe(2);
    expect((state.steps.at(-1)!.state as FakeState).count).toBe(12);
  });

  it("selecting a module with a null run clears the view but keeps history", async () => {
    const store = createPlayerStore((id) => Promise.resolve(makeSandboxFake(id)));
    const actions = store.getState().actions;
    actions.startRun("alpha", "sandbox", { opId: "inc", input: { n: 2 } });
    await settle();
    actions.startRun("alpha", "guided", null);
    expect(store.getState()).toMatchObject({
      moduleId: "alpha",
      mode: "guided",
      run: null,
      steps: [],
      index: -1,
      historyLength: 1,
    });
  });
});

// --- stepper controls -----------------------------------------------------------

describe("stepper controls", () => {
  it("stepForward / stepBack / scrubTo move the index and pause playback", async () => {
    const store = createPlayerStore(() => Promise.resolve(makeGuidedFake()));
    store.getState().actions.startRun("guided-fake", "guided", { scenarioId: "lesson" });
    await settle();
    const actions = store.getState().actions;
    expect(store.getState().index).toBe(0);

    actions.stepForward();
    expect(store.getState().index).toBe(1);
    actions.stepBack();
    expect(store.getState().index).toBe(0);
    actions.stepBack(); // clamped at 0
    expect(store.getState().index).toBe(0);
    actions.scrubTo(2);
    expect(store.getState().index).toBe(2);
    actions.scrubTo(99); // clamped at the end
    expect(store.getState().index).toBe(2);
    actions.scrubTo(-5); // clamped at the start
    expect(store.getState().index).toBe(0);
  });

  it("fastForwardChapter jumps to the next chapter start, then the end", async () => {
    const store = createPlayerStore(() => Promise.resolve(makeGuidedFake()));
    store.getState().actions.startRun("guided-fake", "guided", { scenarioId: "lesson" });
    await settle();
    const actions = store.getState().actions;

    expect(store.getState().chapters.map((chapter) => chapter.label)).toEqual([
      "wal",
      "flush",
      "read",
    ]);
    actions.fastForwardChapter(); // 0 -> chapter "flush" (start 1)
    expect(store.getState().index).toBe(1);
    actions.fastForwardChapter(); // 1 -> chapter "read" (start 2)
    expect(store.getState().index).toBe(2);
    actions.fastForwardChapter(); // no next chapter: stays at the end
    expect(store.getState().index).toBe(2);
  });

  it("setSpeed clamps to the 0.25–2 range", async () => {
    const store = createPlayerStore(() => Promise.resolve(makeGuidedFake()));
    store.getState().actions.startRun("guided-fake", "guided", { scenarioId: "lesson" });
    await settle();
    store.getState().actions.setSpeed(10);
    expect(store.getState().speed).toBe(MAX_SPEED);
    store.getState().actions.setSpeed(0.01);
    expect(store.getState().speed).toBe(MIN_SPEED);
  });
});

// --- settings path: config + setSetting ---------------------------------------

describe("settings path: config + setSetting", () => {
  it("exposes the resolved config once a module loads, null before", async () => {
    const store = createPlayerStore(loadModule);
    expect(store.getState().config).toBeNull();

    // Selecting a module (null run) resolves its config from init().
    store.getState().actions.startRun("_fixture", "guided", null);
    await vi.waitFor(() => expect(store.getState().config).toEqual({ capacity: 8 }));
    expect(store.getState().steps).toEqual([]);
  });

  it("setSetting resets the module and the new config drives the next runs", async () => {
    const store = createPlayerStore(loadModule);
    const actions = store.getState().actions;
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "a" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));

    actions.setSetting("capacity", 2);
    await vi.waitFor(() => {
      const state = store.getState();
      expect(state.config).toEqual({ capacity: 2 });
      expect(state.run).toBeNull();
      expect(state.steps).toEqual([]);
      expect(state.chapters).toEqual([]);
      expect(state.index).toBe(-1);
      expect(state.playing).toBe(false);
      expect(state.historyLength).toBe(0);
    });

    // Runs after the reset use init(newConfig): the second append reaches
    // capacity 2 and emits the cap step instead of growing further.
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "x" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "y" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(2));
    const state = store.getState();
    expect(state.steps.map((step) => step.kind)).toEqual([
      "list.stage",
      "list.commit",
      "list.cap",
    ]);
    const last = state.steps.at(-1)!.state as { capacity: number; items: unknown[] };
    expect(last.capacity).toBe(2);
    expect(last.items).toHaveLength(2);
  });

  it("config survives startRun and reset, and determinism is unaffected", async () => {
    const store = createPlayerStore(loadModule);
    const actions = store.getState().actions;
    actions.startRun("_fixture", "guided", null);
    await vi.waitFor(() => expect(store.getState().config).toEqual({ capacity: 8 }));
    actions.setSetting("capacity", 2);
    await vi.waitFor(() => expect(store.getState().config).toEqual({ capacity: 2 }));

    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "z" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));
    const firstKinds = store.getState().steps.map((step) => step.kind);
    const firstState = store.getState().steps.at(-1)!.state;

    actions.reset();
    expect(store.getState().config).toEqual({ capacity: 2 }); // reset keeps the config
    actions.startRun("_fixture", "sandbox", { opId: "append", input: { value: "z" } });
    await vi.waitFor(() => expect(store.getState().historyLength).toBe(1));
    expect(store.getState().steps.map((step) => step.kind)).toEqual(firstKinds);
    expect(store.getState().steps.at(-1)!.state).toEqual(firstState);
  });

  it("setSetting is a no-op without an active module", () => {
    const store = createPlayerStore(loadModule);
    expect(() => store.getState().actions.setSetting("capacity", 2)).not.toThrow();
    expect(store.getState().config).toBeNull();
  });

  it("keeps config isolated per module", async () => {
    const store = createPlayerStore((id) => Promise.resolve(makeSandboxFake(id)));
    const actions = store.getState().actions;
    actions.startRun("alpha", "sandbox", { opId: "inc" });
    await settle();
    actions.setSetting("burst", 3);
    await settle();
    expect(store.getState().config).toEqual({ burst: 3 });

    actions.startRun("beta", "sandbox", { opId: "inc" });
    await settle();
    expect(store.getState().moduleId).toBe("beta");
    expect(store.getState().config).toBeNull(); // beta was never configured

    actions.startRun("alpha", "sandbox", { opId: "inc" });
    await settle();
    expect(store.getState().config).toEqual({ burst: 3 }); // alpha kept its config
  });
});

// --- autoplay state machine with fake timers -----------------------------------

describe("autoplay through the store", () => {
  it("advances only after onAnimationComplete plus the reading time", async () => {
    vi.useFakeTimers();
    const store = createPlayerStore(() => Promise.resolve(makeGuidedFake()));
    store.getState().actions.startRun("guided-fake", "guided", { scenarioId: "lesson" });
    await settle();
    expect(store.getState().steps).toHaveLength(3);
    expect(store.getState().index).toBe(0);

    store.getState().actions.play();
    expect(store.getState().playing).toBe(true);

    // Hard timeout is 2000 ms: nothing advances before it.
    vi.advanceTimersByTime(1999);
    expect(store.getState().index).toBe(0);

    // Animation completes: the reading timer starts (2 words → 1200 + 2*120 = 1440 ms).
    store.getState().actions.onAnimationComplete();
    vi.advanceTimersByTime(1439);
    expect(store.getState().index).toBe(0);
    vi.advanceTimersByTime(1);
    // Advanced into the "flush.*" step — a key kind → autoplay pauses there.
    expect(store.getState().index).toBe(1);
    expect(store.getState().playing).toBe(false);
  });

  it("the hard timeout advances even when the Render never completes", async () => {
    vi.useFakeTimers();
    const store = createPlayerStore(() => Promise.resolve(makeGuidedFake()));
    store.getState().actions.startRun("guided-fake", "guided", { scenarioId: "lesson" });
    await settle();

    store.getState().actions.play();
    vi.advanceTimersByTime(2000);
    expect(store.getState().index).toBe(1); // key kind "flush" → paused
    expect(store.getState().playing).toBe(false);

    store.getState().actions.play(); // resume from the key step
    vi.advanceTimersByTime(2000);
    expect(store.getState().index).toBe(2); // "read" is not a key kind → still playing
    expect(store.getState().playing).toBe(true);

    vi.advanceTimersByTime(2000); // end of timeline → paused at the last step
    expect(store.getState().playing).toBe(false);
    expect(store.getState().index).toBe(2);
  });

  it("speed scales the autoplay delays", async () => {
    vi.useFakeTimers();
    const store = createPlayerStore(() => Promise.resolve(makeGuidedFake()));
    store.getState().actions.startRun("guided-fake", "guided", { scenarioId: "lesson" });
    await settle();

    store.getState().actions.setSpeed(0.5);
    store.getState().actions.play();
    vi.advanceTimersByTime(3999); // hard timeout is 2000 / 0.5 = 4000 ms
    expect(store.getState().index).toBe(0);
    vi.advanceTimersByTime(1);
    expect(store.getState().index).toBe(1); // pauses at "flush"
  });

  it("manual stepping and pausing cancel pending autoplay timers", async () => {
    vi.useFakeTimers();
    const store = createPlayerStore(() => Promise.resolve(makeGuidedFake()));
    store.getState().actions.startRun("guided-fake", "guided", { scenarioId: "lesson" });
    await settle();

    store.getState().actions.play();
    store.getState().actions.pause();
    vi.advanceTimersByTime(60_000);
    expect(store.getState().index).toBe(0);
    expect(store.getState().playing).toBe(false);

    store.getState().actions.play();
    store.getState().actions.stepForward(); // manual step pauses autoplay
    expect(store.getState().index).toBe(1);
    expect(store.getState().playing).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(store.getState().index).toBe(1);
  });
});
