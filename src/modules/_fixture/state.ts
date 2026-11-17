/**
 * _fixture state model — a counter / append-only list.
 *
 * This module exists to prove the Phase 1 pipeline (contract + discovery +
 * player + conformance + SVG Render) end to end. It is deliberately tiny:
 * an append-only list with a logical clock (`seq`), a capacity guard, and a
 * wholesale reset — the classic "append-only logs cannot delete in place"
 * lesson in miniature.
 *
 * Plain JSON-serializable shapes only: no Map, no Date, no classes, no
 * reliance on `undefined` surviving (PLAN.md §8).
 */

/** Loose config bag — mirrors `Config` from the frozen engine contract. */
export type Config = Record<string, string | number | boolean>;

export interface FixtureItem {
  id: string; // stable entity id, e.g. "e1"
  value: string;
  seq: number; // logical-clock sequence number
}

export interface FixtureState {
  seq: number; // logical clock: the NEXT sequence number to hand out
  items: FixtureItem[]; // appended values, in insertion order
  pending: FixtureItem | null; // staged by `list.stage`, committed by `list.commit`
  capacity: number; // resolved setting: appends beyond this report full
  config: Config; // resolved settings, defaults from `defaultFixtureConfig`
}

export const defaultFixtureConfig: Config = {
  capacity: 8,
};

export function defaultFixtureState(config?: Config): FixtureState {
  const resolved = { ...defaultFixtureConfig, ...config };
  const capacity = typeof resolved.capacity === "number" ? resolved.capacity : 8;
  return { seq: 1, items: [], pending: null, capacity, config: resolved };
}
