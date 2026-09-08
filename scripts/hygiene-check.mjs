#!/usr/bin/env node
// Hygiene check: ensures the repo contains no upstream-brand-words or
// vendor-internal terms in tracked source/doc files. Run from repo root
// via `pnpm hygiene` or as a pre-commit hook.
//
// The grep pattern is split with character classes (e.g. `g[r]asshopper`)
// so this script does not match its own source.
//
// File-level excludes:
//   - package.json / pnpm-lock.yaml / .npmrc — machine-consumed git URLs are
//     legitimate package-manager references and cannot be parameterised.
//   - This script itself.

import { execSync } from 'node:child_process'
import { exit } from 'node:process'

const FORBIDDEN_PATTERNS = [
  'g[r]asshopper',
  'd[e]vcloud',
  't[e]ncent',
]

const EXCLUDE_PATHSPECS = [
  ':!scripts/hygiene-check.mjs',
  // Root and nested package.json must each be excluded — git pathspec `**`
  // glob does not always cover the top-level entry.
  ':!package.json',
  ':!**/package.json',
  ':!pnpm-lock.yaml',
  ':!**/pnpm-lock.yaml',
  ':!package-lock.json',
  ':!**/package-lock.json',
  ':!.npmrc',
  ':!**/.npmrc',
  ':!.git',
  ':!node_modules',
  ':!**/node_modules',
  ':!dist',
  ':!**/dist',
]

let totalHits = 0

for (const pattern of FORBIDDEN_PATTERNS) {
  try {
    const cmd = `git grep -inIE "${pattern}" -- ${EXCLUDE_PATHSPECS.map((p) => `'${p}'`).join(' ')}`
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (out.trim()) {
      console.error(`\n[hygiene] Forbidden pattern hits for /${pattern}/:`)
      console.error(out)
      totalHits += out.split('\n').filter((l) => l).length
    }
  } catch (e) {
    // git grep exits 1 when no matches — treat as success
    if (e.status !== 1) {
      console.error(`[hygiene] git grep failed for ${pattern}:`, e.stderr?.toString() ?? e.message)
      exit(2)
    }
  }
}

if (totalHits > 0) {
  console.error(`\n[hygiene] FAILED — ${totalHits} forbidden term(s). Remove or parameterise them before committing.`)
  exit(1)
}

console.log('[hygiene] OK — no forbidden terms in tracked source/doc files.')
