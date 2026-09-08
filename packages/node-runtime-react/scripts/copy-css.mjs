// Copy every `src/**/*.css` to the mirrored path under `dist/`.
//
// The build is `tsc -b`, which compiles TS/TSX but ignores CSS. The faithful
// editor components import their CSS per-component (`import './X.css'`), so the
// emitted dist JS references CSS files that must sit next to it for a consumer's
// bundler (vite/rollup) to resolve them. This step copies them post-compile.
import { readdirSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(pkgRoot, 'src')
const distDir = join(pkgRoot, 'dist')

let copied = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      walk(abs)
    } else if (entry.endsWith('.css')) {
      const target = join(distDir, relative(srcDir, abs))
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(abs, target)
      copied++
    }
  }
}

walk(srcDir)
console.log(`[copy-css] copied ${copied} CSS file(s) to dist/`)
