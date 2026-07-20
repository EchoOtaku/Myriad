#!/usr/bin/env node
/**
 * Aro no longer ships as frontend/src/tapp/examples/tapps/aro.ts.
 * Source of truth: official tapp-store apps/com.myriad.aro
 *
 * To refresh a local install from the store package:
 *   node scripts/dev/sync-aro-install-from-source.mjs
 *
 * This script only verifies the store package exists and prints its version.
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const storeRoot = process.env.ARO_STORE_ROOT
  ? path.resolve(process.env.ARO_STORE_ROOT)
  : path.resolve(root, '../tapp-store/apps/com.myriad.aro')

const manifestPath = path.join(storeRoot, 'manifest.json')
if (!fs.existsSync(manifestPath)) {
  console.error('Aro store package missing:', storeRoot)
  console.error('Expected sibling checkout: ../tapp-store/apps/com.myriad.aro')
  process.exit(1)
}

const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const pageDir = path.join(storeRoot, 'page')
const modules = fs.existsSync(pageDir)
  ? fs.readdirSync(pageDir).filter((f) => f.endsWith('.js'))
  : []

console.log('Aro source of truth: tapp-store')
console.log('  path:', storeRoot)
console.log('  id:', man.id, 'version:', man.version)
console.log('  page modules:', modules.length)
console.log('  (aro.ts template removed from Myriad examples)')
console.log('  sync install: node scripts/dev/sync-aro-install-from-source.mjs')
