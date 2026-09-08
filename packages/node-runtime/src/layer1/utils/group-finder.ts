/**
 * Resolve a groupId to a JSON file path under one or more search roots.
 *
 * The search supports three layouts (each tried in order, per root):
 *   1. {root}/{category}/{groupId}.json                  flat, two levels
 *   2. {root}/{category}/{groupId}/{any}.json            three levels, dir name == groupId
 *   3. {root}/{category}/{any}/{any}.json                three levels, content's `id` field matches
 *
 * Plugins pass their resolved roots (typically {batteries-dir}/groups and
 * {batteries-dir}/templates after path-slot resolution); the kernel itself
 * does not hardcode the layout.
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function searchDir(baseDir: string, groupId: string): string | null {
  if (!existsSync(baseDir)) return null
  try {
    for (const category of readdirSync(baseDir)) {
      const catPath = join(baseDir, category)
      if (!statSync(catPath).isDirectory()) continue

      // Layout 1: {category}/{groupId}.json
      const flat = join(catPath, `${groupId}.json`)
      if (existsSync(flat)) return flat

      // Layout 2: {category}/{groupId}/{any}.json
      const nestedDir = join(catPath, groupId)
      if (existsSync(nestedDir) && statSync(nestedDir).isDirectory()) {
        const file = readdirSync(nestedDir).find((f) => f.endsWith('.json'))
        if (file) return join(nestedDir, file)
      }

      // Layout 3: scan every subdir, match by JSON content's `id` field
      for (const subDir of readdirSync(catPath)) {
        const subDirPath = join(catPath, subDir)
        if (!statSync(subDirPath).isDirectory()) continue
        for (const file of readdirSync(subDirPath)) {
          if (!file.endsWith('.json')) continue
          const filePath = join(subDirPath, file)
          try {
            const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as { id?: string }
            if (parsed.id === groupId) return filePath
          } catch {
            /* skip files that fail to parse */
          }
        }
      }
    }
  } catch {
    /* ignore scan errors */
  }
  return null
}

/**
 * Search every root directory in order; returns the first match or null.
 *
 * @param roots   absolute paths of roots to search (plugin supplies them)
 * @param groupId the group / template id to resolve
 */
export function findGroupJsonFile(roots: readonly string[], groupId: string): string | null {
  for (const root of roots) {
    const hit = searchDir(root, groupId)
    if (hit !== null) return hit
  }
  return null
}
