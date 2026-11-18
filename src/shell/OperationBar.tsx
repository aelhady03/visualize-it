// OperationBar — top bar with operation buttons, settings controls and the
// guided/sandbox mode toggle (PLAN.md §4).
//
// Operation buttons come from the module's declared `operations`; settings
// controls from its `settings`. Guided operations map to a guided scenario
// (the store's guided runs are scenario-driven: startRun takes a scenarioId);
// sandbox operations with an inputSchema reveal a SandboxForm first (or the
// module's InputForm override).
//
// The mode toggle is a UI preference for the NEXT run: the player store
// (lane A's seam) has no setMode action — its `mode` is set by `startRun`
// itself. The store's current mode seeds the toggle on mount.

import { useState } from 'react'
import { usePlayerStore, type PlayerStore } from '@core/player/store'
import type {
  FieldSpec,
  OpInput,
  Operation,
  Scenario,
  SettingSpec,
} from '@core/engine-contract'
import { SandboxForm } from './SandboxForm'
import { scenarioForOp } from './scenarioForOp'

type Mode = PlayerStore['mode']

export interface OperationBarProps {
  /** The module these operations belong to (startRun keys the store by it). */
  moduleId: string
  operations: Operation[]
  settings: SettingSpec[]
  /** Guided scenarios, for mapping operation buttons to scenario runs. */
  scenarios: Scenario<unknown>[]
  /** Module-provided InputForm override (VizModule.InputForm). */
  inputForm?: React.ComponentType<{
    fields: FieldSpec[]
    values: OpInput
    onChange: (v: OpInput) => void
  }>
}

const MODE_HELP: Record<Mode, string> = {
  guided: 'Plays a prepared example, one step at a time.',
  sandbox: 'Runs the operation on keys and values you type.',
}

function defaultValues(fields: FieldSpec[] | undefined): OpInput {
  const defaults: OpInput = {}
  for (const field of fields ?? []) {
    if (field.default !== undefined) defaults[field.id] = field.default
  }
  return defaults
}

function defaultSettings(settings: SettingSpec[]): Record<string, string | number | boolean> {
  return Object.fromEntries(settings.map((s) => [s.id, s.default]))
}

export function OperationBar({
  moduleId,
  operations,
  settings,
  scenarios,
  inputForm,
}: OperationBarProps) {
  const { mode: storeMode, actions } = usePlayerStore()
  const [mode, setMode] = useState<Mode>(() => storeMode)

  const [selectedOpId, setSelectedOpId] = useState<string | null>(null)
  const [values, setValues] = useState<OpInput>({})
  // Lazy init only: the viewer remounts this bar (keyed by module id) when the
  // module — and therefore the SettingSpec list — changes.
  const [settingValues, setSettingValues] = useState<Record<string, string | number | boolean>>(() =>
    defaultSettings(settings),
  )

  const selected = operations.find((op) => op.id === selectedOpId) ?? null
  const selectedMode = selected && selected.mode === 'both' ? mode : selected?.mode
  const needsForm = selected !== null && selectedMode === 'sandbox' && !!selected.inputSchema

  const run = (op: Operation) => {
    // Selection always resets the form to this operation's schema defaults.
    setValues(defaultValues(op.inputSchema))
    setSelectedOpId(op.id)

    const opMode = op.mode === 'both' ? mode : op.mode
    if (opMode === 'sandbox') {
      if (op.inputSchema) return // wait for the form's submit
      actions.startRun(moduleId, opMode, { opId: op.id })
      return
    }
    // Guided: the store runs scenarios; start the scenario for this operation.
    const scenario = scenarioForOp(scenarios, op)
    if (scenario) actions.startRun(moduleId, opMode, { scenarioId: scenario.id })
  }

  const submit = () => {
    if (selected) actions.startRun(moduleId, mode, { opId: selected.id, input: values })
  }

  const applySetting = (id: string, value: string | number | boolean) => {
    // Display-only for now: the player store has no settings/config path yet
    // (engine.init() is called without config). Wiring a setting change means
    // resetting the module to init(newConfig) — a store-level change.
    setSettingValues((prev) => ({ ...prev, [id]: value }))
  }

  const canRun = (op: Operation): boolean => {
    const opMode = op.mode === 'both' ? mode : op.mode
    if (opMode === 'sandbox') return true
    return scenarioForOp(scenarios, op) !== undefined
  }

  return (
    <section aria-label="Operations" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1">
          <div
            role="group"
            aria-label="Operation mode"
            className="inline-flex w-fit rounded-md border border-rule bg-band p-0.5"
          >
            {(['guided', 'sandbox'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={[
                  'h-8 rounded-[5px] px-3 text-[0.875rem] transition-colors',
                  mode === m
                    ? 'bg-paper font-[600] text-ink shadow-[0_0_0_1px_var(--rule)]'
                    : 'text-ink-soft hover:text-ink',
                ].join(' ')}
              >
                {m === 'guided' ? 'Guided' : 'Sandbox'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Run an operation">
          {operations.map((op) => {
            const enabled = canRun(op)
            const isSelected = selected?.id === op.id
            return (
              <button
                key={op.id}
                type="button"
                title={enabled ? op.description : `${op.description} No guided example yet: switch to Sandbox.`}
                aria-pressed={isSelected}
                disabled={!enabled}
                onClick={() => run(op)}
                className={[
                  'h-9 rounded-md border px-3.5 text-[0.9375rem] font-[550] transition-colors disabled:border-dashed disabled:opacity-45',
                  isSelected
                    ? 'border-pen bg-pen text-pen-ink'
                    : 'border-pen/50 bg-paper text-pen enabled:hover:border-pen enabled:hover:bg-pen/10',
                ].join(' ')}
              >
                {op.label}
              </button>
            )
          })}

          {operations.length === 0 && (
            <p className="text-[0.875rem] text-ink-soft">This module has no operations to run yet.</p>
          )}
        </div>

        <p className="basis-full text-[0.875rem] text-ink-soft md:basis-auto">{MODE_HELP[mode]}</p>
      </div>

      {settings.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Module settings">
          {settings.map((setting) => {
            const value = settingValues[setting.id]
            const controlId = `setting-${setting.id}`
            return (
              <label key={setting.id} className="flex items-center gap-2 text-[0.875rem]">
                {setting.type === 'boolean' && (
                  <input
                    id={controlId}
                    className="h-4 w-4 accent-[var(--pen)]"
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => applySetting(setting.id, e.target.checked)}
                  />
                )}
                <span className="font-[550] text-ink">{setting.label}</span>
                {setting.type === 'select' && (
                  <select
                    id={controlId}
                    className="h-8 rounded-md border border-rule bg-paper px-2 text-[0.875rem]"
                    value={typeof value === 'string' ? value : String(value)}
                    onChange={(e) => applySetting(setting.id, e.target.value)}
                  >
                    {setting.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}
                {setting.type === 'number' && (
                  <input
                    id={controlId}
                    className="voice-printed h-8 w-20 rounded-md border border-rule bg-paper px-2 text-[0.875rem]"
                    type="number"
                    value={typeof value === 'number' ? value : ''}
                    onChange={(e) =>
                      applySetting(setting.id, e.target.value === '' ? '' : Number(e.target.value))
                    }
                  />
                )}
                {setting.hint && <span className="text-ink-soft">{setting.hint}</span>}
              </label>
            )
          })}
        </div>
      )}

      {needsForm && selected?.inputSchema && (
        <SandboxForm
          fields={selected.inputSchema}
          values={values}
          onChange={setValues}
          onSubmit={submit}
          submitLabel={`Run ${selected.label.toLowerCase()}`}
          InputForm={inputForm}
        />
      )}
    </section>
  )
}
