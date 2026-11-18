// SandboxForm — form generated from an operation's inputSchema (PLAN.md §4).
//
// Renders one control per FieldSpec (text / number / select / boolean) and
// calls onChange with the collected OpInput. If the module provides an
// InputForm override, that component renders instead of the generated form.
// Text and number inputs use the printed voice: what you type is data.

import type { FieldSpec, OpInput } from '@core/engine-contract'

export interface SandboxFormProps {
  fields: FieldSpec[]
  values: OpInput
  onChange: (values: OpInput) => void
  onSubmit: () => void
  /** Submit button text; say what happens ("Run write"). Defaults to "Run". */
  submitLabel?: string
  /** Module-provided override (VizModule.InputForm). */
  InputForm?: React.ComponentType<{
    fields: FieldSpec[]
    values: OpInput
    onChange: (v: OpInput) => void
  }>
}

const CONTROL_CLASS =
  'h-9 rounded-md border border-rule bg-[var(--viz-surface)] px-2.5 text-[0.9375rem] text-ink placeholder:text-ink-soft/70'

const SUBMIT_CLASS =
  'h-9 rounded-md bg-pen px-4 text-[0.9375rem] font-[600] text-pen-ink transition-[filter] hover:brightness-110'

const FORM_CLASS = 'flex flex-wrap items-end gap-x-4 gap-y-3 rounded-[10px] border border-dashed border-pen/45 px-4 py-3'

export function SandboxForm({
  fields,
  values,
  onChange,
  onSubmit,
  submitLabel = 'Run',
  InputForm,
}: SandboxFormProps) {
  if (InputForm) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
        className={FORM_CLASS}
        aria-label="Sandbox input"
      >
        <InputForm fields={fields} values={values} onChange={onChange} />
        <button type="submit" className={SUBMIT_CLASS}>
          {submitLabel}
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
      className={FORM_CLASS}
      aria-label="Sandbox input"
    >
      {fields.map((field) => {
        const raw = values[field.id]
        const controlId = `sandbox-${field.id}`
        const hintId = field.hint ? `${controlId}-hint` : undefined

        if (field.type === 'boolean') {
          return (
            <div key={field.id} className="flex flex-col gap-1 self-center">
              <label htmlFor={controlId} className="flex items-center gap-2 text-[0.875rem] font-[550]">
                <input
                  id={controlId}
                  className="h-4 w-4 accent-[var(--pen)]"
                  type="checkbox"
                  checked={Boolean(raw)}
                  aria-describedby={hintId}
                  onChange={(e) => set(field.id, e.target.checked)}
                />
                {field.label}
              </label>
              {field.hint && (
                <span id={hintId} className="max-w-[36ch] text-[0.8125rem] text-ink-soft">
                  {field.hint}
                </span>
              )}
            </div>
          )
        }

        return (
          <div key={field.id} className="flex flex-col gap-1">
            <label htmlFor={controlId} className="text-[0.8125rem] font-[550] text-ink-soft">
              {field.label}
              {field.required ? <span aria-hidden="true"> (required)</span> : null}
            </label>

            {field.type === 'text' && (
              <input
                id={controlId}
                className={`${CONTROL_CLASS} voice-printed w-36`}
                type="text"
                value={typeof raw === 'string' ? raw : ''}
                required={field.required}
                aria-describedby={hintId}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => set(field.id, e.target.value)}
              />
            )}

            {field.type === 'number' && (
              <input
                id={controlId}
                className={`${CONTROL_CLASS} voice-printed w-24`}
                type="number"
                value={typeof raw === 'number' ? raw : ''}
                required={field.required}
                aria-describedby={hintId}
                onChange={(e) => set(field.id, e.target.value === '' ? '' : Number(e.target.value))}
              />
            )}

            {field.type === 'select' && (
              <select
                id={controlId}
                className={CONTROL_CLASS}
                value={typeof raw === 'string' ? raw : (field.options?.[0] ?? '')}
                aria-describedby={hintId}
                onChange={(e) => set(field.id, e.target.value)}
              >
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {field.hint && (
              <span id={hintId} className="max-w-[36ch] text-[0.8125rem] text-ink-soft">
                {field.hint}
              </span>
            )}
          </div>
        )
      })}

      <button type="submit" className={SUBMIT_CLASS}>
        {submitLabel}
      </button>
    </form>
  )
}
