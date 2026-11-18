// Smoke tests for the semantic theme tokens (PLAN.md §3.4):
// - the JS mapping exposes exactly the nine tokens as CSS variable references;
// - the CSS declares every token with a LIGHT and a DARK value, and the two
//   palettes actually differ (dark mode is not a no-op).

/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { roleTokens, VIZ_TOKEN_KEYS, vizTokens, vizVar } from './tokens'

// Read the CSS source directly: `?raw` imports come back empty under Vitest,
// and import.meta.url is not a file: URL in the jsdom environment.
const cssText = readFileSync(join(process.cwd(), 'src/core/theme/theme.css'), 'utf8')

describe('tokens.ts JS mapping', () => {
  it('maps every semantic token to its CSS variable', () => {
    expect(VIZ_TOKEN_KEYS).toHaveLength(11)
    for (const key of VIZ_TOKEN_KEYS) {
      expect(vizTokens[key]).toBe(`var(--viz-${key})`)
      expect(vizVar(key)).toBe(`var(--viz-${key})`)
    }
  })

  it('maps every highlight role to a token key', () => {
    expect(roleTokens).toEqual({
      active: 'active',
      hit: 'hit',
      miss: 'miss',
      removed: 'removed',
      new: 'new',
      stale: 'removed',
    })
  })
})

describe('theme.css light + dark values', () => {
  const lightBlock = cssText.match(/:root\s*\{([^}]*)\}/s)?.[1] ?? ''
  const darkMatch = cssText.match(/prefers-color-scheme:\s*dark[^{]*\{([^}]*)\}/s)
  const darkBlock = darkMatch?.[1] ?? ''

  it('declares a dark palette via prefers-color-scheme', () => {
    expect(darkMatch).not.toBeNull()
  })

  for (const key of VIZ_TOKEN_KEYS) {
    const varName = `--viz-${key}`

    it(`declares light and dark values for ${varName}`, () => {
      const light = lightBlock.match(new RegExp(`${varName}:\\s*([^;]+)`))?.[1]
      const dark = darkBlock.match(new RegExp(`${varName}:\\s*([^;]+)`))?.[1]
      expect(light, 'light value').toMatch(/^#[0-9a-f]{6}$/)
      expect(dark, 'dark value').toMatch(/^#[0-9a-f]{6}$/)
    })

    it(`${varName} light and dark values differ`, () => {
      const light = lightBlock.match(new RegExp(`${varName}:\\s*([^;]+)`))?.[1]
      const dark = darkBlock.match(new RegExp(`${varName}:\\s*([^;]+)`))?.[1]
      expect(dark).not.toBe(light)
    })
  }

  it('registers every token with Tailwind (@theme)', () => {
    for (const key of VIZ_TOKEN_KEYS) {
      expect(cssText).toContain(`--color-viz-${key}: var(--viz-${key})`)
    }
  })

  it('keeps the tombstone color muted (distinct from every other token)', () => {
    const light = lightBlock.match(/--viz-tombstone:\s*([^;]+)/)?.[1]
    const others = VIZ_TOKEN_KEYS.filter((k) => k !== 'tombstone').map(
      (k) => lightBlock.match(new RegExp(`--viz-${k}:\\s*([^;]+)`))?.[1],
    )
    expect(others).not.toContain(light)
  })
})
