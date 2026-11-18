import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Difficulty } from './Difficulty'

afterEach(cleanup)

describe('Difficulty', () => {
  it.each([
    ['beginner', 'text-level-beginner', 1],
    ['intermediate', 'text-level-intermediate', 2],
    ['advanced', 'text-level-advanced', 3],
  ])('colors %s from the level ramp, with steps and the word', (level, colorClass, steps) => {
    const { container } = render(<Difficulty level={level} showLabel />)
    const mark = container.querySelector(`[data-level="${level}"]`)!
    expect(mark.className).toContain(colorClass)
    const filled = [...container.querySelectorAll('rect')].filter((r) => r.getAttribute('fill-opacity') === '1')
    expect(filled).toHaveLength(steps)
    expect(screen.getByText(level)).toBeTruthy()
  })

  it('keeps the word for assistive tech when the label is hidden', () => {
    render(<Difficulty level="advanced" />)
    expect(screen.getByText('advanced').className).toContain('sr-only')
  })

  it('falls back to neutral ink for an unknown level', () => {
    const { container } = render(<Difficulty level="expert" />)
    expect(container.querySelector('[data-level="unknown"]')!.className).toContain('text-ink-soft')
  })
})
