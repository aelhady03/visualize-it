/**
 * _fixture meta — the eager half of module discovery (PLAN.md §3.2).
 * Exports exactly what the sidebar needs: `meta`, `operations`, `settings`.
 */

import type { Operation, SettingSpec } from "@core/engine-contract";
import type { VizModule } from "@core/view-contract";

export const meta = {
  id: "_fixture",
  title: "Counter · Append-Only List",
  description:
    "The Phase 1 spike module: append values to an in-memory list, watch the staged → committed arc, then reset it wholesale.",
  topics: ["append-only log", "logical clock"],
  difficulty: "beginner",
  category: "Fixture",
  order: 0,
} as const satisfies VizModule<unknown>["meta"];

export const operations: Operation[] = [
  {
    id: "append",
    label: "Append",
    description: "Append one value to the end of the list.",
    mode: "both",
    inputSchema: [
      {
        id: "value",
        label: "Value",
        type: "text",
        required: true,
        hint: "Any non-empty text value.",
      },
    ],
  },
  {
    id: "clear",
    label: "Clear",
    description: "Reset the list to empty in one shot.",
    mode: "guided",
  },
];

export const settings: SettingSpec[] = [
  {
    id: "capacity",
    label: "Capacity",
    type: "number",
    default: 8,
    hint: "The list reports full once it holds this many items.",
  },
];
