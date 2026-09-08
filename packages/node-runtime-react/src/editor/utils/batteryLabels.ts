// Battery naming / category labels: turn battery.id and battery.type/category
// into readable labels and accent colours. Ported verbatim from the legacy
// editor (utils/batteryLabels.ts).

/** Format a battery id (snake_case / camelCase) into a readable English label. */
export function formatIdAsLabel(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Derive the big-label display name from battery.type + category. */
export function getBatteryBigLabel(type: string, category: string): string {
  const raw = type === 'ts' ? category.split('/')[0] || type : type
  if (raw === 'json') return 'JSON'
  if (raw === 'special') return 'Special'
  if (raw === 'ai') return 'AI'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/** Full category path for tooltip tag lines: "BigLabel / SmallLabel". */
export function getBatteryTagLine(type: string, category: string): string {
  const bigLabel = getBatteryBigLabel(type, category)
  const smallSegment = type === 'ts' ? category.split('/')[1] : category
  if (!smallSegment) return bigLabel
  const smallLabel = formatIdAsLabel(smallSegment)
  if (smallLabel === bigLabel) return bigLabel
  return `${bigLabel} / ${smallLabel}`
}

/** Accent colour for a battery.type (matches the palette big-label tabs). */
export function getBatteryTypeColor(type: string): string | undefined {
  const map: Record<string, string> = {
    ai: '#FC8181',
    special: '#60a5fa',
    json: '#FCA823',
  }
  return map[type]
}
