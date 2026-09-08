import { describe, expect, it } from 'vitest'

import {
  CANONICAL_TYPE_META,
  getPortTypeColor,
  isTypeCompatible,
  resolveCanonicalTypeMeta,
  type DomainPortTypes,
} from '../utils/portTypes.js'

const DOMAIN_TYPES: DomainPortTypes = [
  { type: 'scene', desc: '场景', descEn: 'Scene', color: '#fb923c' },
  { type: 'geometry', desc: '几何', descEn: 'Geometry', color: '#f87171', compatibleWith: ['string'] },
]

describe('port type registry', () => {
  it('keeps domain types out of the core defaults', () => {
    expect(CANONICAL_TYPE_META.some((m) => m.type === 'scene')).toBe(false)
    expect(CANONICAL_TYPE_META.some((m) => m.type === 'geometry')).toBe(false)
    expect(CANONICAL_TYPE_META.some((m) => m.type === 'asset_grid')).toBe(false)
    // Without the explicit prop, an unknown domain type degrades to grey.
    expect(getPortTypeColor('scene')).toBe('#6b7280')
    expect(resolveCanonicalTypeMeta().some((m) => m.type === 'scene')).toBe(false)
    expect(resolveCanonicalTypeMeta().some((m) => m.type === 'asset_grid')).toBe(false)
    expect(getPortTypeColor('asset_grid')).toBe('#6b7280')
    expect(isTypeCompatible('asset_grid', 'grid')).toBe(false)
  })

  it('resolves domain port colours and compatibility from the explicit prop', () => {
    expect(resolveCanonicalTypeMeta(DOMAIN_TYPES).map((m) => m.type)).toContain('scene')
    expect(getPortTypeColor('scene', DOMAIN_TYPES)).toBe('#fb923c')
    expect(isTypeCompatible('scene', 'dict', DOMAIN_TYPES)).toBe(false)
    expect(isTypeCompatible('geometry', 'string', DOMAIN_TYPES)).toBe(true)
  })

  it('does not leak domain types across calls (no global state)', () => {
    // Resolving with the prop must not mutate the shared default legend.
    resolveCanonicalTypeMeta(DOMAIN_TYPES)
    expect(CANONICAL_TYPE_META.some((m) => m.type === 'scene')).toBe(false)
    expect(getPortTypeColor('scene')).toBe('#6b7280')
  })
})
