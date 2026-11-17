// Guided scenario lookup for operation buttons (PLAN.md §3.3: a guided run
// plays one scenario). Lives in its own file so OperationBar.tsx only exports
// components (react-refresh/only-export-components).

import type { Operation, Scenario } from '@core/engine-contract'

/** The guided scenario an operation button plays: same id, or first op matches. */
export function scenarioForOp(
  scenarios: Scenario<unknown>[],
  op: Operation,
): Scenario<unknown> | undefined {
  return (
    scenarios.find((scenario) => scenario.id === op.id) ??
    scenarios.find((scenario) => scenario.ops[0]?.opId === op.id)
  )
}
