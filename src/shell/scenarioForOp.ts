// Guided scenario lookup for operation buttons (PLAN.md §3.3: a guided run
// plays one scenario). Lives in its own file so OperationBar.tsx only exports
// components (react-refresh/only-export-components).

import type { Operation, Scenario } from '@core/engine-contract'

/**
 * The guided scenario an operation button plays:
 * 1. a scenario whose id equals the op id, else
 * 2. one whose FIRST op matches (the intended tour), else
 * 3. one whose ops CONTAIN the op (so update/delete/compact/crash still get
 *    a narrated example even when their scenarios open with writes).
 */
export function scenarioForOp(
  scenarios: Scenario<unknown>[],
  op: Operation,
): Scenario<unknown> | undefined {
  return (
    scenarios.find((scenario) => scenario.id === op.id) ??
    scenarios.find((scenario) => scenario.ops[0]?.opId === op.id) ??
    scenarios.find((scenario) => scenario.ops.some((o) => o.opId === op.id))
  )
}
