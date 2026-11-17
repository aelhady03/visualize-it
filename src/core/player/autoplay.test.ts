import { afterEach, describe, expect, it, vi } from "vitest";
import type { Step } from "../engine-contract";
import {
  AutoplayEngine,
  HARD_TIMEOUT_MS,
  isKeyKind,
  readingMs,
} from "./autoplay";

function step(kind: string, narration = "one short narration"): Step<unknown> {
  return { kind, state: {}, narration };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isKeyKind", () => {
  it("flags flush and compact prefixes, and tombstone/bloom anywhere", () => {
    expect(isKeyKind("flush.start")).toBe(true);
    expect(isKeyKind("compact.stcs-merge")).toBe(true);
    expect(isKeyKind("read.tombstone-hit")).toBe(true);
    expect(isKeyKind("read.bloom-false-positive")).toBe(true);
    expect(isKeyKind("read.leveled-l0")).toBe(false);
    expect(isKeyKind("memtable.insert")).toBe(false);
  });
});

describe("readingMs", () => {
  it("grows with narration length and stays clamped", () => {
    expect(readingMs("short")).toBeGreaterThan(readingMs("tiny") - 1);
    expect(readingMs("one two three")).toBeGreaterThan(readingMs("short"));
    expect(readingMs("a b c d e f g h i j k l m n o p q r s t u v w x y z")).toBeLessThanOrEqual(8000);
    expect(readingMs("x")).toBeGreaterThanOrEqual(1500);
  });
});

describe("AutoplayEngine", () => {
  it("advances on the hard timeout when completion never arrives", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const engine = new AutoplayEngine(advance);
    engine.enter(step("wal.append"), 1);
    vi.advanceTimersByTime(HARD_TIMEOUT_MS - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("switches to the reading timer once the animation completes", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const narration = "a three word narration";
    const engine = new AutoplayEngine(advance);
    engine.enter(step("wal.append", narration), 1);
    engine.complete(step("wal.append", narration), 1);
    const wait = readingMs(narration);
    vi.advanceTimersByTime(wait - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    // The hard timer was cleared: no second advance.
    vi.advanceTimersByTime(HARD_TIMEOUT_MS * 2);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("remembers a completed animation across pause/resume", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const narration = "remembered after pause";
    const engine = new AutoplayEngine(advance);
    engine.enter(step("wal.append", narration), 1);
    engine.stop();
    engine.complete(step("wal.append", narration), 1); // completed while paused
    engine.resume(step("wal.append", narration), 1);
    vi.advanceTimersByTime(readingMs(narration));
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("resume without a completed animation re-arms the hard timeout", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const engine = new AutoplayEngine(advance);
    engine.enter(step("wal.append"), 1);
    engine.stop();
    engine.resume(step("wal.append"), 1);
    vi.advanceTimersByTime(HARD_TIMEOUT_MS);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("scales both delays by speed", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const engine = new AutoplayEngine(advance);
    engine.enter(step("wal.append"), 0.5);
    vi.advanceTimersByTime(HARD_TIMEOUT_MS * 2 - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("cancel forgets everything", () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const engine = new AutoplayEngine(advance);
    engine.enter(step("wal.append"), 1);
    engine.complete(step("wal.append"), 1);
    engine.cancel();
    vi.advanceTimersByTime(60_000);
    expect(advance).not.toHaveBeenCalled();
  });
});
