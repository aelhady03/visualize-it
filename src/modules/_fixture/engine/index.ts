/**
 * _fixture engine — pure simulation (imports only `@core/engine-contract` and
 * this module's own pure files, per the ESLint boundaries).
 *
 * Operations:
 * - `append` (2–3 steps): stage the item, commit it, and (when the capacity is
 *   reached) a cap step. On a full list it emits a normal `list.full` step —
 *   state-dependent refusal is NOT an invalid-input error (contract §3.1).
 * - `clear` (2 steps): mark every item for removal, then drop them all at once.
 *
 * Deterministic: `seq` is a logical clock; no randomness, no Date.now().
 */

import type { Config, OpInput, RunResult, Step } from "@core/engine-contract";
import { defaultFixtureState, type FixtureItem, type FixtureState } from "../state";

export function init(config?: Config): FixtureState {
  return defaultFixtureState(config);
}

export function run(
  opId: string,
  input: OpInput | undefined,
  prev: FixtureState,
): RunResult<FixtureState> {
  switch (opId) {
    case "append":
      return append(input, prev);
    case "clear":
      return clear(prev);
    default:
      return { steps: [], result: prev, error: `unknown op id "${opId}"` };
  }
}

function append(input: OpInput | undefined, prev: FixtureState): RunResult<FixtureState> {
  const value = typeof input?.value === "string" ? input.value.trim() : "";
  if (value === "") {
    return { steps: [], result: prev, error: "append needs a non-empty value" };
  }

  if (prev.items.length >= prev.capacity) {
    const step: Step<FixtureState> = {
      kind: "list.full",
      state: prev,
      narration:
        "The list is already at its capacity, so the append is refused without changing anything.",
    };
    return { steps: [step], result: prev };
  }

  const item: FixtureItem = { id: `e${prev.seq}`, value, seq: prev.seq };
  const stagedStep: Step<FixtureState> = {
    kind: "list.stage",
    state: { ...prev, pending: item },
    narration: `"${value}" is staged at the end of the list before it is committed.`,
    highlights: [{ id: item.id, role: "new" }],
  };

  const committed: FixtureState = {
    ...prev,
    seq: prev.seq + 1,
    items: [...prev.items, item],
    pending: null,
  };
  const commitStep: Step<FixtureState> = {
    kind: "list.commit",
    state: committed,
    narration: `"${value}" is appended, so the list now holds ${committed.items.length} item(s).`,
    highlights: [{ id: item.id, role: "active" }],
  };

  const steps: Step<FixtureState>[] = [stagedStep, commitStep];
  if (committed.items.length >= prev.capacity) {
    steps.push({
      kind: "list.cap",
      state: committed,
      narration: "The list just reached its capacity, so the next append will report full.",
    });
  }
  return { steps, result: committed };
}

function clear(prev: FixtureState): RunResult<FixtureState> {
  const markStep: Step<FixtureState> = {
    kind: "reset.stage",
    state: prev,
    narration:
      "Every item is marked for removal at once — an append-only log resets wholesale instead of deleting in place.",
    highlights: prev.items.map((item) => ({ id: item.id, role: "removed" })),
  };

  const cleared: FixtureState = { ...prev, items: [], pending: null };
  const dropStep: Step<FixtureState> = {
    kind: "reset.drop",
    state: cleared,
    narration: "The list is empty again, ready for new appends.",
  };
  return { steps: [markStep, dropStep], result: cleared };
}
