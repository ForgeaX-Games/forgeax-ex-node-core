// Compact display of 2D grid arrays inside JSON text: keeps each row of numbers
// on a single line to reduce line count and make grids easier to read in panels.
// Ported verbatim from the legacy editor (utils/gridFormat.ts).

/**
 * Compress grid arrays in JSON text so each row of numbers renders contiguously,
 * reducing the number of lines. Also collapses blank lines between the outer
 * brackets of a 2D array and its inner rows:
 *   rule 1: `[\n<digit>` -> `[<digit>`   (inner-array start)
 *   rule 2: `<digit>\n]` -> `<digit>]`   (inner-array end)
 *   rule 3: `<digit>,\n<digit>` -> `<digit>,<digit>`  (merge inner elements)
 *   rule 4: `, <digit>` -> `,<digit>`    (drop space after comma)
 *   rule 5: `[\n[` -> `[\n[`             (trim blank lines between outer `[` and inner row)
 *   rule 6: `],\n[` -> `],\n[`           (trim blank lines between adjacent inner rows)
 *   rule 7: collapse runs of blank lines into a single blank line
 */
export function compactGridArrays(text: string): string {
  let result = text
  result = result.replace(/\[\s*(\d+)/g, '[$1')
  result = result.replace(/(\d+)\s*\]/g, '$1]')
  result = result.replace(/(\d+),\s*\n\s*(\d+)/g, '$1,$2')
  result = result.replace(/,\s+(\d+)/g, ',$1')
  // Trim blank lines between an outer `[` and the following inner `[` row.
  result = result.replace(/\[\s*\n(\s*\[)/g, '[\n$1')
  // Trim blank lines between adjacent inner rows (`],` newline whitespace `[`).
  result = result.replace(/\],\s*\n(\s*\[)/g, '],\n$1')
  // Collapse runs of blank lines (more than one) into a single blank line.
  result = result.replace(/\n{3,}/g, '\n\n')
  return result
}
