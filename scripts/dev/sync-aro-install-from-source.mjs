#!/usr/bin/env node
/**
 * Sync local installed Aro package (data/tapps/<owner>/com.myriad.aro)
 * from frontend/src/tapp/examples/tapps/aro.ts.
 *
 * Why: Aro source changes do NOT auto-update installed packages. After editing
 * aro.ts, either use Tapp Store "update from code" or run this script.
 *
 * Usage (from repo root):
 *   node --experimental-strip-types scripts/dev/sync-aro-install-from-source.mjs
 *   # or with tsx:
 *   npx tsx scripts/dev/sync-aro-install-from-source.mjs
 *
 * Env:
 *   ARO_INSTALL_ROOT  override path (default: backend/data/tapps/1/com.myriad.aro)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const defaultRoot = path.join(repoRoot, 'backend/data/tapps/1/com.myriad.aro')
const installRoot = process.env.ARO_INSTALL_ROOT
  ? path.resolve(process.env.ARO_INSTALL_ROOT)
  : defaultRoot

const aroModuleUrl = pathToFileURL(
  path.join(repoRoot, 'frontend/src/tapp/examples/tapps/aro.ts'),
).href

const { aroTapp } = await import(aroModuleUrl)
const code = aroTapp.code
const mods = code.pageModules || {}

if (!fs.existsSync(path.dirname(installRoot))) {
  console.error('Parent of install root missing:', path.dirname(installRoot))
  process.exit(1)
}
fs.mkdirSync(installRoot, { recursive: true })
const pageDir = path.join(installRoot, 'page')
fs.mkdirSync(pageDir, { recursive: true })
const i18nDir = path.join(installRoot, 'i18n')
fs.mkdirSync(i18nDir, { recursive: true })

fs.writeFileSync(path.join(installRoot, 'index.js'), code.core || '')
if (code.styles) fs.writeFileSync(path.join(installRoot, 'styles.css'), code.styles)
if (code.pageHtml) fs.writeFileSync(path.join(installRoot, 'page.html'), code.pageHtml)
for (const [name, content] of Object.entries(mods)) {
  fs.writeFileSync(path.join(pageDir, name), content)
}

const man = {
  ...aroTapp.manifest,
  pageModules: aroTapp.manifest.pageModules,
}
fs.writeFileSync(
  path.join(installRoot, 'manifest.json'),
  `${JSON.stringify(man, null, 2)}\n`,
)

const i18n = code.i18n || {}
for (const [key, file] of [
  ['zh', 'zh.json'],
  ['en', 'en.json'],
  ['ja', 'ja.json'],
]) {
  if (i18n[key]) {
    fs.writeFileSync(
      path.join(i18nDir, file),
      `${JSON.stringify(i18n[key], null, 2)}\n`,
    )
  }
}

fs.writeFileSync(
  path.join(installRoot, '.myriad-install-state.json'),
  `${JSON.stringify({ updatedAtMicros: Date.now() * 1000 })}\n`,
)

console.log('Synced Aro →', installRoot)
console.log(
  '  modules:',
  Object.keys(mods).length,
  'core bytes:',
  (code.core || '').length,
  'version:',
  man.version,
)
