// SandboxForm — form generated from an operation's inputSchema (PLAN.md §4).
//
// Renders one control per FieldSpec (text / number / select / boolean) and
// calls onChange with the collected OpInput. If the module provides an
// InputForm override, that component renders instead of the generated form.

import type { FieldSpec, OpInput } from '@core/engine-contract'

export interface SandboxFormProps {
  fields: FieldSpec[]
  values: OpInput
  onChange: (values: OpInput) => void
  onSubmit: () => void
  /** Module-provided override (VizModule.InputForm). */
  InputForm?: React.ComponentType<{
    fields: FieldSpec[]
    values: OpInput
    onChange: (v: OpInput) => void
  }>
}

const CONTROL_CLASS =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'

export function SandboxForm({ fields, values, onChange, onSubmit, InputForm }: SandboxFormProps) {
  if (InputForm) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <InputForm fields={fields} values={values} onChange={onChange} />
        <button type="submit" className="mt-2 rounded-md bg-sky-600 px-3 py-1 text-sm text-white">
          Run
        </button>
      </form>
    )
  }

  const set = (id: string, value: string | number | boolean) => onChange({ ...values, [id]: value })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="flex flex-wrap items-end gap-3"
      aria-label="Sandbox input"
    >
      {fields.map((field) => {
        const raw = values[field.id]
        const controlId = `sandbox-${field.id}`
        return (
          <label key={field.id} className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-neutral-600 dark:text-neutral-400">
              {field.label}
              {field.required ? ' *' : ''}
            </span>

            {field.type === 'text' && (
              <input
                id={controlId}
                className={CONTROL_CLASS}
                type="text"
                value={typeof raw === 'string' ? raw : ''}
                required={field.required}
                onChange={(e) => set(field.id, e.target.value)}
              />
            )}

            {field.type === 'number' && (
              <input
                id={controlId}
                className={CONTROL_CLASS}
                type="number"
                value={typeof raw === 'number' ? raw : ''}
                required={field.required}
                onChange={(e) => set(field.id, e.target.value === '' ? '' : Number(e.target.value))}
              />
            )}

            {field.type === 'select' && (
              <select
                id={controlId}
                className={CONTROL_CLASS}
                value={typeof raw === 'string' ? raw : field.options?.[0] ?? ''}
                onChange={(e) => set(field.id, e.target.value)}
              >
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {field.type === 'boolean' && (
              <input
                id={controlId}
                className="mt-1 h-4 w-4"
                type="checkbox"
                checked={Boolean(raw)}
                onChange={(e) => set(field.id, e.target.checked)}
              />
            )}

            {field.hint && (
              <span className="text-xs text-neutral-500 dark:text-neutral-500">{field.hint}</span>
            )}
          </label>
        )
      })}

      <button
        type="submit"
        className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700"
      >
        Run
      </button>
    </form>
  )
}
