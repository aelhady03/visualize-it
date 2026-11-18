// Smoke tests for the shared SVG primitives: each renders its content, honors
// the namespaced layoutId convention (dropped under reduced motion), and maps
// highlight roles / tones to the semantic --viz-* tokens.

import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { Arrow, BitArray, Box, FileShape, KeyCell, keyCellWidth } from './index'

afterEach(cleanup)

function Svg({ children }: { children: ReactNode }) {
  return <svg data-testid="svg">{children}</svg>
}

function firstByTag(container: HTMLElement, tag: string): Element {
  const el = container.querySelector(tag)
  if (!el) throw new Error(`no <${tag}> found`)
  return el
}

describe('Box', () => {
  it('renders a rect with its centered label', () => {
    const { container } = render(
      <Svg>
        <Box x={0} y={0} width={80} height={30} label="wal-01" />
      </Svg>,
    )
    expect(screen.getByText('wal-01')).toBeTruthy()
    const rect = firstByTag(container, 'rect')
    expect(rect.getAttribute('x')).toBe('0')
    expect(rect.getAttribute('width')).toBe('80')
  })

  it('maps tone and role to semantic tokens', () => {
    const { container } = render(
      <Svg>
        <Box x={0} y={0} width={40} height={20} tone="memtable" role="hit" />
      </Svg>,
    )
    const rect = firstByTag(container, 'rect')
    expect(rect.getAttribute('fill')).toBe('var(--viz-memtable)')
    expect(rect.getAttribute('stroke')).toBe('var(--viz-hit)')
  })

  it('draws the tombstone cross pattern (shape distinct from color)', () => {
    const { container } = render(
      <Svg>
        <Box x={0} y={0} width={40} height={20} tone="tombstone" pattern="tombstone" />
      </Svg>,
    )
    const cross = container.querySelector('path')
    expect(cross?.getAttribute('stroke')).toBe('var(--viz-tombstone)')
  })

  it('keeps the namespaced layoutId, and drops it under reduced motion', () => {
    const withMotion = render(
      <Svg>
        <Box x={0} y={0} width={10} height={10} layoutId="memtable-1:e17" />
      </Svg>,
    )
    expect(withMotion.container.querySelector('[data-layout-id="memtable-1:e17"]')).toBeTruthy()

    const reduced = render(
      <Svg>
        <Box x={0} y={0} width={10} height={10} layoutId="memtable-1:e17" reducedMotion />
      </Svg>,
    )
    expect(reduced.container.querySelector('[data-layout-id]')).toBeNull()
  })

  it('renders children inside the group', () => {
    const { container } = render(
      <Svg>
        <Box x={0} y={0} width={40} height={20}>
          <circle data-testid="child" r={3} />
        </Box>
      </Svg>,
    )
    expect(container.querySelector('[data-testid="child"]')).toBeTruthy()
  })
})

describe('KeyCell', () => {
  it('renders key, value and seq in separate compartments', () => {
    const { container } = render(
      <Svg>
        <KeyCell x={0} y={0} label="alpha" value="v1" seq={7} />
      </Svg>,
    )
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.getByText('#7')).toBeTruthy()
    // the drawn rect is exactly as wide as keyCellWidth reports
    expect(firstByTag(container, 'rect').getAttribute('width')).toBe(
      String(keyCellWidth('alpha', 'v1', 7)),
    )
  })

  it('marks a tombstone by shape (hatch + headstone) as well as color', () => {
    const { container } = render(
      <Svg>
        <KeyCell x={0} y={0} label="alpha" tone="tombstone" />
      </Svg>,
    )
    expect(container.querySelector('pattern')).toBeTruthy()
    expect(container.querySelector('[data-glyph="tombstone"]')).toBeTruthy()
    expect(firstByTag(container, 'rect').getAttribute('fill')).toBe('var(--viz-tombstone)')
  })

  it('maps a role to its token color', () => {
    const { container } = render(
      <Svg>
        <KeyCell x={0} y={0} label="alpha" role="miss" />
      </Svg>,
    )
    expect(firstByTag(container, 'rect').getAttribute('stroke')).toBe('var(--viz-miss)')
  })
})

describe('Arrow', () => {
  it('renders a shaft and an arrowhead', () => {
    const { container } = render(
      <Svg>
        <Arrow from={{ x: 0, y: 0 }} to={{ x: 50, y: 0 }} label="flush" />
      </Svg>,
    )
    expect(container.querySelector('line')).toBeTruthy()
    expect(container.querySelector('polygon')).toBeTruthy()
    expect(screen.getByText('flush')).toBeTruthy()
  })

  it('uses the role color for shaft and head', () => {
    const { container } = render(
      <Svg>
        <Arrow from={{ x: 0, y: 0 }} to={{ x: 10, y: 10 }} role="active" />
      </Svg>,
    )
    expect(firstByTag(container, 'line').getAttribute('stroke')).toBe('var(--viz-active)')
  })
})

describe('BitArray', () => {
  it('renders one cell per bit, filled when set', () => {
    const { container } = render(
      <Svg>
        <BitArray x={0} y={0} bits={[1, 0, 1]} label="bloom" />
      </Svg>,
    )
    const rects = container.querySelectorAll('rect')
    expect(rects).toHaveLength(3)
    expect(rects[0].getAttribute('fill')).toBe('var(--viz-file)')
    expect(rects[1].getAttribute('fill')).toBe('none')
    expect(screen.getByText('bloom')).toBeTruthy()
  })

  it('colors highlighted indices with the role token', () => {
    const { container } = render(
      <Svg>
        <BitArray x={0} y={0} bits={[0, 0]} highlight={[0]} role="miss" />
      </Svg>,
    )
    const rects = container.querySelectorAll('rect')
    expect(rects[0].getAttribute('fill')).toBe('var(--viz-miss)')
    expect(rects[1].getAttribute('fill')).toBe('none')
  })

  it('points at each probed position with a shape, not only a color', () => {
    const { container } = render(
      <Svg>
        <BitArray x={0} y={0} bits={[1, 0, 1, 0]} highlight={[0, 2]} />
      </Svg>,
    )
    const probes = [...container.querySelectorAll('[data-probe]')].map((p) => p.getAttribute('data-probe'))
    expect(probes).toEqual(['0', '2'])
  })
})

describe('FileShape', () => {
  it('renders the page outline with folded corner and label', () => {
    const { container } = render(
      <Svg>
        <FileShape x={0} y={0} width={60} height={30} label="sstable-3" />
      </Svg>,
    )
    expect(screen.getByText('sstable-3')).toBeTruthy()
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(2) // outline + fold
    expect(paths[0].getAttribute('fill')).toBe('var(--viz-file)')
  })

  it('renders one segment strip per block', () => {
    const { container } = render(
      <Svg>
        <FileShape
          x={0}
          y={0}
          width={60}
          height={30}
          segments={[{ label: 'a' }, { label: 'm' }]}
        />
      </Svg>,
    )
    expect(container.querySelectorAll('rect')).toHaveLength(2)
  })

  it('draws metadata footer blocks distinct from data blocks', () => {
    const { container } = render(
      <Svg>
        <FileShape x={0} y={0} width={120} height={30} segments={[{ label: 'a' }]} footer={['index', 'filter']} />
      </Svg>,
    )
    expect(container.querySelectorAll('[data-block]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-footer]')).toHaveLength(2)
    expect(screen.getByText('filter')).toBeTruthy()
  })
})
