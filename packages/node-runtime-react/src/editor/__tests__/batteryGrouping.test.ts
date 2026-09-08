import { describe, it, expect } from 'vitest'
import {
  formatSmallLabel,
  getBigLabel,
  getSmallLabel,
  isTemplateBattery,
  sortSmallLabels,
} from '../components/sidebar/batteryGrouping.js'
import type { Battery } from '../types.js'

// B: the palette accordion groups by big tag (rail) + small tag (sub-group),
// both derived from the on-disk "bigTag/smallTag" category. These regressions
// pin the two bugs the dir-derived category model exposed:
//   1. un-cased big tags (scene30 / components / common …) leaked the WHOLE
//      "bigTag/smallTag" string as the small label ("全串").
//   2. type==='special' returned the BIG tag as the small label, collapsing
//      every special battery into a single "special" sub-group.
const make = (over: Partial<Battery>): Battery =>
  ({ id: 'x', name: 'x', type: 'ts', category: 'ts', inputs: [], outputs: [], ...over }) as Battery

describe('BatteryBar grouping labels', () => {
  it('big label is the first category segment (the on-disk big tag)', () => {
    expect(getBigLabel(make({ type: 'scene30', category: 'scene30/indoor' }))).toBe('scene30')
    expect(getBigLabel(make({ type: 'common', category: 'common/list' }))).toBe('common')
  })

  it('small label is the SECOND segment for every type (no "全串")', () => {
    expect(getSmallLabel(make({ type: 'scene30', category: 'scene30/indoor' }))).toBe('indoor')
    expect(getSmallLabel(make({ type: 'components', category: 'components/districts' }))).toBe('districts')
    expect(getSmallLabel(make({ type: 'common', category: 'common/list' }))).toBe('list')
    expect(getSmallLabel(make({ type: 'ai', category: 'ai/providers' }))).toBe('providers')
  })

  it('special no longer collapses: the sub-tag wins over the big tag', () => {
    // Was returning category.split('/')[0] === 'special' for every entry.
    expect(getSmallLabel(make({ type: 'special', category: 'special/number' }))).toBe('number')
    expect(getSmallLabel(make({ type: 'special', category: 'special/list' }))).toBe('list')
  })

  it('falls back to the single segment / type when there is no sub-folder', () => {
    expect(getSmallLabel(make({ type: 'scene', category: 'scene' }))).toBe('scene')
  })

  it('displayGroup overrides the category for templates', () => {
    const tpl = make({ type: 'group', category: 'groups', displayGroup: 'templates/architecture' })
    expect(getBigLabel(tpl)).toBe('templates')
    expect(getSmallLabel(tpl)).toBe('architecture')
  })

  it('sorts common small labels in the curated battery order', () => {
    expect(sortSmallLabels(
      ['number', 'preview', 'list', 'input', 'datatree', 'z_extra'],
      'common',
    )).toEqual(['input', 'list', 'datatree', 'number', 'preview', 'z_extra'])
  })

  it('formats preview as Annotation for common annotation batteries', () => {
    expect(formatSmallLabel('preview')).toBe('Annotation')
  })

  // Template-vs-group bucketing keys off the BIG label, not an exact displayGroup
  // match. 'groups/<cat>' stays in Develop (GROUPS tab, sub-categorized); every
  // other group big label (templates/…) is a template (Templates mode).
  describe('isTemplateBattery', () => {
    it('groups/<cat> is a normal group battery (Develop), not a template', () => {
      expect(isTemplateBattery(make({ type: 'group', category: 'general', displayGroup: 'groups/general' }))).toBe(false)
    })
    it('templates/<cat> is a template', () => {
      expect(isTemplateBattery(make({ type: 'group', category: 'architecture', displayGroup: 'templates/architecture' }))).toBe(true)
    })
    it('a group with no displayGroup stays in Develop (big label "groups")', () => {
      expect(isTemplateBattery(make({ type: 'group', category: 'groups' }))).toBe(false)
    })
    it('bare displayGroup "groups" stays in Develop', () => {
      expect(isTemplateBattery(make({ type: 'group', category: 'groups', displayGroup: 'groups' }))).toBe(false)
    })
    it('non-group batteries are never templates', () => {
      expect(isTemplateBattery(make({ type: 'ts', category: 'scene30/indoor' }))).toBe(false)
    })
  })
})
