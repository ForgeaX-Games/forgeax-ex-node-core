import { describe, expect, it } from 'vitest'
import { formatPortValue, formatPortValueExtra } from '../components/canvas/nodeTooltip.js'
import type { DomainValueFormatters } from '../components/canvas/nodeTooltip.js'

const sceneValue = {
  tree: {
    path: '/',
    version: 1,
    schema: 'root',
    cells: [],
    children: [
      { path: '/house', version: 2, schema: 'building', cells: [{ x: 0, y: 0, z: 0 }], children: [] },
    ],
  },
  focus: '/house',
}

describe('domain value formatters', () => {
  // P5: formatters are passed explicitly (per editor instance, via the
  // ValueFormattersContext in app code) — no module-global to reset.
  it('lets a domain format raw runtime values before the generic dict fallback', () => {
    const formatters: DomainValueFormatters = [
      {
        format(value) {
          return value === sceneValue ? 'scene focus="/house" nodes=1' : undefined
        },
        formatExtra(value) {
          return value === sceneValue ? 'schema="building"' : undefined
        },
      },
    ]

    expect(formatPortValue(sceneValue, formatters)).toBe('scene focus="/house" nodes=1')
    expect(formatPortValueExtra(sceneValue, formatters)).toBe('schema="building"')
  })

  it('uses domain formatting for DataTree items instead of summarising them as dicts', () => {
    const formatters: DomainValueFormatters = [
      {
        format(value) {
          return value === sceneValue ? 'scene focus="/house" nodes=1' : undefined
        },
      },
    ]

    expect(formatPortValue([{ path: [0], items: [sceneValue] }], formatters)).toBe('scene focus="/house" nodes=1')
  })

  it('summarises DataTree string lists and previews flattened items', () => {
    const childPaths = [
      { path: [0, 0], items: ['/Root/A'] },
      { path: [0, 1], items: ['/Root/B'] },
    ]

    expect(formatPortValue(childPaths)).toBe('2 items · 2B')
    expect(formatPortValueExtra(childPaths)).toBe('["/Root/A", "/Root/B"]')
  })
})
