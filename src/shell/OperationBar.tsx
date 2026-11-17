// OperationBar — top bar with operation buttons, settings controls and the
// guided/sandbox mode toggle (PLAN.md §4).
//
// Operation buttons come from the module's declared `operations`; settings
// controls from its `settings`. Guided operations start immediately; sandbox
// operations with an inputSchema reveal a SandboxForm first (or the module's
// InputForm override).
//
// Playback state (mode, startRun) comes from the player store via
// usePlayerStore(). The seam's brief lists no mode/settings mutators, so the
// toggle and settings are wired through an optional-action shim: they call
// setMode/setSetting when the store provides them and degrade to display-only
// when it does not.

import { useState } from 'react'
import { usePlayerStore } from '@core/player/store'
import type { FieldSpec, OpInput, Operation, SettingSpec } from '@core/engine-contract'
import { SandboxForm } from './SandboxForm'

/** Optional seam extensions (reconciled against lane A's store at wiring time). */
interface ExtendedActions {
  setMode?(mode: 'guided' | 'sandbox'): void
  setSetting?(id: string, value: string | number | boolean): void
}

export interface OperationBarProps {
  operations: Operation[]
  settings: SettingSpec[]
  /** Module-provided InputForm override (VizModule.InputForm). */
  inputForm?: React.ComponentType<{
    fields: FieldSpec[]
    values: OpInput
    onChange: (v: OpInput) => void
  }>
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

export function OperationBar({ operations, settings, inputForm }: OperationBarProps) {
  const { mode, actions } = usePlayerStore()
  const extended = actions as typeof actions & ExtendedActions

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
    if (opMode === 'sandbox' && op.inputSchema) {
      return // wait for the form's submit
    }
    actions.startRun(op.id, undefined)
  }

  const submit = () => {
    if (selected) actions.startRun(selected.id, values)
  }

  const applySetting = (id: string, value: string | number | boolean) => {
    setSettingValues((prev) => ({ ...prev, [id]: value }))
    extended.setSetting?.(id, value)
  }

  return (
    <section aria-label="Operations" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Operation mode"
          className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700"
        >
          {(['guided', 'sandbox'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => extended.setMode?.(m)}
              className={[
                'px-3 py-1 text-sm capitalize',
                mode === m
                  ? 'bg-sky-600 font-medium text-white'
                  : 'bg-white text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-neutral-300 dark:bg-neutral-700" aria-hidden="true" />

        {operations.map((op) => (
          <button
            key={op.id}
            type="button"
            title={op.description}
            aria-pressed={selected?.id === op.id}
            onClick={() => run(op)}
            className={[
              'rounded-md border px-3 py-1 text-sm transition-colors',
              selected?.id === op.id
                ? 'border-sky-600 bg-sky-600 font-medium text-white'
                : 'border-neutral-300 bg-white text-neutral-800 hover:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200',
            ].join(' ')}
          >
            {op.label}
          </button>
        ))}

        {operations.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No operations.</p>
        )}
      </div>

      {settings.length > 0 && (
        <div className="flex flex-wrap items-center gap-3" aria-label="Module settings">
          {settings.map((setting) => {
            const value = settingValues[setting.id]
            const controlId = `setting-${setting.id}`
            return (
              <label key={setting.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  {setting.label}
                </span>
                {setting.type === 'select' && (
                  <select
                    id={controlId}
                    className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
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
                {setting.type === 'boolean' && (
                  <input
                    id={controlId}
                    className="h-4 w-4"
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => applySetting(setting.id, e.target.checked)}
                  />
                )}
                {setting.type === 'number' && (
                  <input
                    id={controlId}
                    className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                    type="number"
                    value={typeof value === 'number' ? value : ''}
                    onChange={(e) =>
                      applySetting(setting.id, e.target.value === '' ? '' : Number(e.target.value))
                    }
                  />
                )}
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
          InputForm={inputForm}
        />
      )}
    </section>
  )
}
