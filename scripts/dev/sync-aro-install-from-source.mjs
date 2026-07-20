#!/usr/bin/env node
/**
 * Sync local installed Aro package (data/tapps/<owner>/com.myriad.aro)
 * from the official tapp-store checkout (source of truth).
 *
 * Source: sibling repo ../tapp-store/apps/com.myriad.aro
 *   or ARO_STORE_ROOT / TAPP_STORE_ROOT env overrides.
 *
 * Usage (from Myriad repo root):
 *   node scripts/dev/sync-aro-install-from-source.mjs
 *
 * Env:
 *   ARO_INSTALL_ROOT  install target (default: backend/data/tapps/1/com.myriad.aro)
 *   ARO_STORE_ROOT    store package root (default: ../tapp-store/apps/com.myriad.aro)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const defaultInstall = path.join(repoRoot, 'backend/data/tapps/1/com.myriad.aro')
const installRoot = process.env.ARO_INSTALL_ROOT
  ? path.resolve(process.env.ARO_INSTALL_ROOT)
  : defaultInstall

const defaultStore = path.resolve(repoRoot, '../tapp-store/apps/com.myriad.aro')
const storeRoot = process.env.ARO_STORE_ROOT
  ? path.resolve(process.env.ARO_STORE_ROOT)
  : process.env.TAPP_STORE_ROOT
    ? path.join(path.resolve(process.env.TAPP_STORE_ROOT), 'apps/com.myriad.aro')
    : defaultStore

if (!fs.existsSync(path.join(storeRoot, 'manifest.json'))) {
  console.error('Aro store package not found:', storeRoot)
  console.error('Clone Myriad-You/tapp-store next to Myriad, or set ARO_STORE_ROOT.')
  process.exit(1)
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else copyFile(s, d)
  }
}

// Fresh install tree (keep .myriad-install-state if present)
const statePath = path.join(installRoot, '.myriad-install-state.json')
const prevState = fs.existsSync(statePath)
  ? fs.readFileSync(statePath, 'utf8')
  : null

fs.rmSync(installRoot, { recursive: true, force: true })
fs.mkdirSync(installRoot, { recursive: true })

// Copy package files (skip README.md — not needed at runtime)
for (const name of fs.readdirSync(storeRoot)) {
  if (name === 'README.md') continue
  const s = path.join(storeRoot, name)
  const d = path.join(installRoot, name)
  const st = fs.statSync(s)
  if (st.isDirectory()) copyDir(s, d)
  else copyFile(s, d)
}

const man = JSON.parse(
  fs.readFileSync(path.join(installRoot, 'manifest.json'), 'utf8'),
)

fs.writeFileSync(
  path.join(installRoot, '.myriad-install-state.json'),
  prevState
  || `${JSON.stringify({ updatedAtMicros: Date.now() * 1000 })}\n`,
)

console.log('Synced Aro from tapp-store →', installRoot)
console.log('  version:', man.version, 'main:', man.main)
console.log('  pageModules:', (man.pageModules || []).length)
