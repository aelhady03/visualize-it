// SandboxForm: generates fields from a schema, supports every FieldSpec
// type, and defers to a module-provided InputForm override.

import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FieldSpec, OpInput } from '@core/engine-contract'
import { SandboxForm } from './SandboxForm'

afterEach(cleanup)

const FIELDS: FieldSpec[] = [
  { id: 'key', label: 'Key', type: 'text', required: true },
  { id: 'value', label: 'Value', type: 'text', default: 'v0' },
  { id: 'count', label: 'Count', type: 'number', default: 2 },
  { id: 'strategy', label: 'Strategy', type: 'select', options: ['stcs', 'leveled'], default: 'stcs' },
  { id: 'verbose', label: 'Verbose', type: 'boolean', default: false },
  { id: 'extra', label: 'Extra', type: 'text', hint: 'optional detail' },
]

describe('SandboxForm', () => {
  it('renders one control per schema field with labels', () => {
    render(
      <SandboxForm fields={FIELDS} values={{}} onChange={() => {}} onSubmit={() => {}} />,
    )
    for (const field of FIELDS) {
      expect(screen.getByText(new RegExp(field.label))).toBeTruthy()
    }
    expect(screen.getByLabelText(/Key/)).toBeTruthy()
    expect(screen.getByLabelText(/Count/)).toBeTruthy()
    expect(screen.getByLabelText(/Strategy/)).toBeTruthy()
    expect(screen.getByLabelText(/Verbose/)).toBeTruthy()
    expect(screen.getByText('optional detail')).toBeTruthy()
  })

  it('reports typed values through onChange', () => {
    const onChange = vi.fn()
    render(<SandboxForm fields={FIELDS} values={{}} onChange={onChange} onSubmit={() => {}} />)

    fireEvent.change(screen.getByLabelText(/Key/), { target: { value: 'alpha' } })
    expect(onChange).toHaveBeenLastCalledWith({ key: 'alpha' })

    fireEvent.change(screen.getByLabelText(/Count/), { target: { value: '5' } })
    expect(onChange).toHaveBeenLastCalledWith({ count: 5 })

    fireEvent.change(screen.getByLabelText(/Strategy/), { target: { value: 'leveled' } })
    expect(onChange).toHaveBeenLastCalledWith({ strategy: 'leveled' })

    fireEvent.click(screen.getByLabelText(/Verbose/))
    expect(onChange).toHaveBeenLastCalledWith({ verbose: true })
  })

  it('submits the collected values', () => {
    const onSubmit = vi.fn()
    render(
      <SandboxForm
        fields={FIELDS}
        values={{ key: 'alpha', count: 3 }}
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.submit(screen.getByRole('form', { name: 'Sandbox input' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('renders the module InputForm override instead of generated fields', () => {
    const Override: React.ComponentType<{
      fields: FieldSpec[]
      values: OpInput
      onChange: (v: OpInput) => void
    }> = ({ values, onChange }) => (
      <input
        aria-label="Custom input"
        value={typeof values.key === 'string' ? values.key : ''}
        onChange={(e) => onChange({ key: e.target.value })}
      />
    )
    render(
      <SandboxForm fields={FIELDS} values={{}} onChange={() => {}} onSubmit={() => {}} InputForm={Override} />,
    )
    expect(screen.getByLabelText('Custom input')).toBeTruthy()
    expect(screen.queryByLabelText(/Key/)).toBeNull()
  })
})
