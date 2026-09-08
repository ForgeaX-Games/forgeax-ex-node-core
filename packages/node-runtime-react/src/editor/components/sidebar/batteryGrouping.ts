// 大/小标签派生与排序（自 BatteryBar.tsx 抽出的纯函数层，便于单测与复用）。
//   ─ 大标签（左侧 rail 一级分组）
//   ─ 小标签（手风琴二级分组）
//   ─ 组内电池排序（部分大/小标签有人工 curated 顺序，其余 A→Z）
// 这些函数全部是无副作用的派生逻辑，不依赖 React / DOM / store。
import type { Battery } from '../../types.js'

// 模板/多项目相关字段不在通用 Battery 类型中（属 app 级），用局部扩展类型读取，保持移植忠实度
export type CatalogBattery = Battery & { sourcePath?: string; projectTypes?: string[] }

// 模板判定：group 电池且大标签不是 'groups'。
//   groups/<cat>   → 大标签 'groups' → Develop 模式 GROUPS 大标签（普通成组电池）
//   templates/<cat> → 大标签 'templates' → Templates 模式（特殊子集）
//   无 displayGroup 的图内 group → 大标签 'groups' → Develop（保持原行为）
export function isTemplateBattery(battery: Battery): boolean {
  return battery.type === 'group' && getBigLabel(battery) !== 'groups'
}

export function getBigLabel(battery: Battery): string {
  if (battery.displayGroup) return battery.displayGroup.split('/')[0] || battery.type
  if (battery.type === 'ts') return battery.category.split('/')[0] || battery.type
  if (battery.type === 'group') return 'groups'
  return battery.type
}

/** 模板电池所在子目录名（templates/{category}/{subfolder}/…） */
export function getTemplateSubfolder(battery: Battery): string {
  const sourcePath = (battery as CatalogBattery).sourcePath
  if (!sourcePath) return battery.id
  const parts = sourcePath.replace(/\\/g, '/').split('/')
  const idx = parts.indexOf('templates')
  if (idx >= 0 && parts.length > idx + 2) return parts[idx + 2]
  return battery.id
}

export function getSmallLabel(battery: Battery): string {
  // Batteries group by their on-disk layout "bigTag/smallTag" (category), or by
  // an explicit displayGroup override (templates). The accordion sub-group is the
  // SECOND path segment; fall back to the first segment / type when a battery
  // sits directly under its big tag with no sub-folder.
  //
  // This is derived uniformly for every type. The previous per-type branches
  // returned the WHOLE "bigTag/smallTag" string for un-cased types (scene /
  // scene30 / components / basic / groups / json / common …) — so e.g. every
  // scene30 battery landed in a distinct "scene30/indoor"-style label instead of
  // collapsing into an "indoor" sub-group — and returned the BIG tag for
  // type==='special', collapsing all special batteries into one "special" group.
  const path = battery.displayGroup ?? battery.category ?? ''
  const parts = path.split('/')
  return parts.length >= 2 ? parts[1] : (parts[0] || battery.type)
}

export function formatBigLabel(label: string): string {
  if (label === 'json') return 'JSON'
  if (label === 'special') return 'SPECIAL'
  if (label === 'ai') return 'AI'
  if (label === 'groups') return 'GROUPS'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function formatBigLabelRailText(label: string): string {
  const clean = formatBigLabel(label).trim()
  if (!clean) return ''
  return clean.slice(0, 2)
}

export function formatBigLabelRailRest(label: string): string {
  return formatBigLabel(label).trim().slice(2)
}

export function formatSmallLabel(label: string): string {
  if (label === 'preview') return 'Annotation'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function applyOrder(savedOrder: string[], allLabels: string[]): string[] {
  const result = savedOrder.filter(l => allLabels.includes(l))
  for (const l of allLabels) {
    if (!result.includes(l)) result.push(l)
  }
  return result
}

export function sortSmallLabels(labels: string[], bigLabel: string | null): string[] {
  const sorted = [...labels].sort()
  // The common batteries (input / list / number …) live under the `common` big
  // tag (batteries-common); curate their sub-group order, everything else A→Z.
  if (bigLabel !== 'common') return sorted
  const priority = ['input', 'list', 'datatree', 'number', 'preview']
  return sorted.sort((a, b) => {
    const ai = priority.indexOf(a)
    const bi = priority.indexOf(b)
    if (ai >= 0 || bi >= 0) {
      if (ai < 0) return 1
      if (bi < 0) return -1
      return ai - bi
    }
    return a.localeCompare(b)
  })
}

const COMMON_NUMBER_ORDER = [
  'seed_control',
  'random_number',
  'random_numbers',
  'range_list',
  'basic_math_op',
  'advanced_math_op',
  'negate',
  'relu',
  'compare_gt',
  'compare_gte',
]

const COMMON_LIST_ORDER = [
  'list_get_length',
  'list_get_single',
  'list_get_by_index',
  'list_get_index_single',
  'list_get_index_by_item',
  'list_remove_by_index',
  'list_difference',
  'list_unpack',
  'list_collect',
  'dict_get_by_key',
  'dict_get_keys_by_value',
]

const BASIC_GENERAL_ORDER = [
  'rect_grid',
  'grid_size',
  'point_to_rect',
]

export function sortBatteriesInGroup(items: Battery[], bigLabel: string | null, smallLabel: string): Battery[] {
  const sorted = [...items]
  const priority = bigLabel === 'common' && smallLabel === 'list'
    ? COMMON_LIST_ORDER
    : bigLabel === 'common' && smallLabel === 'number'
      ? COMMON_NUMBER_ORDER
    : bigLabel === 'basic' && smallLabel === 'general'
      ? BASIC_GENERAL_ORDER
      : null
  if (priority) {
    return sorted.sort((a, b) => {
      const ai = priority.indexOf(a.id)
      const bi = priority.indexOf(b.id)
      if (ai >= 0 || bi >= 0) {
        if (ai < 0) return 1
        if (bi < 0) return -1
        return ai - bi
      }
      return a.id.localeCompare(b.id)
    })
  }
  return sorted.sort((a, b) => a.id.localeCompare(b.id))
}
