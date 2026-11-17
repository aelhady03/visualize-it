/**
 * _fixture guided scenarios — small multi-op scripts feeding `engine.run`.
 * Two `append` ops followed by a `clear` produce a 6-step timeline with two
 * chapters ("list" and "reset") when played through the player.
 */

import type { Scenario } from "@core/engine-contract";
import type { FixtureState } from "../state";

export const scenarios: Scenario<FixtureState>[] = [
  {
    id: "append-then-clear",
    title: "Append, then clear",
    description:
      "Append two values to the list, then reset it — a tiny append-only-log arc: stage, commit, wipe.",
    ops: [
      { opId: "append", input: { value: "apple" } },
      { opId: "append", input: { value: "banana" } },
      { opId: "clear" },
    ],
  },
];
