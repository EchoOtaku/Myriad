/**
 * Structural guard: deleted dead-code paths must stay gone,
 * and live wiring for LoadingFallback CSS / config tests must remain.
 *
 * Run from repo root: node scripts/dev/verify-dead-code-removed.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repo = process.env.REPO_ROOT || path.resolve(scriptDir, '../..')

const mustBeGone = [
  'frontend/src/components/CacheManagement.tsx',
  'frontend/src/pages/_CacheManagementPage.tsx',
  'frontend/src/scripts/page-transition.ts',
  'frontend/src/scripts/performance-monitor.ts',
  'frontend/src/tapp/runtime/TappPageSandboxWebKit.css',
  'frontend/src/components/brew/cards/CardSkeleton.tsx',
  'frontend/src/components/brew/cards/EmptyState.tsx',
  'frontend/src/components/config/GenericConfigSection.tsx',
  'frontend/src/components/config/PlatformConfigSection.tsx',
  'backend/src/services/metadata_filter.rs',
  'backend/src/config_test.rs',
  'backend/src/services/content_databases/auto_populate.rs',
  'backend/src/services/content_databases/learning.rs',
]

const mustExist = [
  'frontend/src/styles/global.css',
  'frontend/src/App.tsx',
  'frontend/src/components/brew/cards/index.ts',
  'frontend/src/components/config/index.ts',
  'frontend/src/components/brew/constants.ts',
  'backend/src/services/mod.rs',
  'backend/src/services/content_databases/mod.rs',
  'backend/src/services/content_databases/anime_database.rs',
  'backend/src/services/content_databases/game_database.rs',
  'backend/src/services/content_databases/artist_database.rs',
  'backend/src/services/smart_filter.rs',
  'backend/src/config.rs',
  'backend/src/federation/mod.rs',
]

let failed = 0

for (const rel of mustBeGone) {
  if (fs.existsSync(path.join(repo, rel))) {
    console.error(`FAIL: dead file still exists: ${rel}`)
    failed++
  } else {
    console.log(`OK gone: ${rel}`)
  }
}

for (const rel of mustExist) {
  if (!fs.existsSync(path.join(repo, rel))) {
    console.error(`FAIL: expected live file missing: ${rel}`)
    failed++
  } else {
    console.log(`OK exists: ${rel}`)
  }
}

const cardsIndex = fs.readFileSync(
  path.join(repo, 'frontend/src/components/brew/cards/index.ts'),
  'utf8',
)
for (const bad of [
  'CardSkeleton',
  'EmptyState',
  'CardSkeletonProps',
  'EmptyStateProps',
]) {
  if (cardsIndex.includes(bad)) {
    console.error(`FAIL: cards/index.ts still exports ${bad}`)
    failed++
  }
}

const configIndex = fs.readFileSync(
  path.join(repo, 'frontend/src/components/config/index.ts'),
  'utf8',
)
for (const bad of ['GenericConfigSection', 'PlatformConfigSection']) {
  if (configIndex.includes(bad)) {
    console.error(`FAIL: config/index.ts still exports ${bad}`)
    failed++
  }
}

const servicesMod = fs.readFileSync(
  path.join(repo, 'backend/src/services/mod.rs'),
  'utf8',
)
if (servicesMod.includes('metadata_filter')) {
  console.error('FAIL: services/mod.rs still declares metadata_filter')
  failed++
}

const cdMod = fs.readFileSync(
  path.join(repo, 'backend/src/services/content_databases/mod.rs'),
  'utf8',
)
if (
  /\bmod auto_populate\b/.test(cdMod) ||
  /\bmod learning\b/.test(cdMod) ||
  cdMod.includes('auto_learn_from_unknown_content')
) {
  console.error(
    'FAIL: content_databases/mod.rs still declares auto_populate/learning',
  )
  failed++
} else {
  console.log('OK content_databases/mod.rs without auto_populate/learning modules')
}
if (
  !cdMod.includes('anime_database') ||
  !cdMod.includes('game_database') ||
  !cdMod.includes('artist_database')
) {
  console.error('FAIL: static content databases must remain for token savings')
  failed++
} else {
  console.log('OK static Anime/Game/Artist databases remain')
}

const smartFilter = fs.readFileSync(
  path.join(repo, 'backend/src/services/smart_filter.rs'),
  'utf8',
)
if (
  smartFilter.includes('auto_learn_from_unknown_content') ||
  smartFilter.includes('flush_unknown_stats')
) {
  console.error('FAIL: smart_filter still references auto-learn / unknown stats')
  failed++
} else {
  console.log('OK smart_filter without auto-learn path')
}

const app = fs.readFileSync(path.join(repo, 'frontend/src/App.tsx'), 'utf8')
if (!app.includes("import './styles/global.css'")) {
  console.error("FAIL: App.tsx missing import './styles/global.css'")
  failed++
}
if (!app.includes('loading-fallback-light')) {
  console.error('FAIL: App.tsx no longer uses loading-fallback-light')
  failed++
}

const globalCss = fs.readFileSync(
  path.join(repo, 'frontend/src/styles/global.css'),
  'utf8',
)
if (!globalCss.includes('loading-fallback-light')) {
  console.error('FAIL: global.css missing loading-fallback-light')
  failed++
}

// E2E crypto is a live federation module (must remain).
if (!fs.existsSync(path.join(repo, 'backend/src/federation/e2e.rs'))) {
  console.error('FAIL: backend/src/federation/e2e.rs missing (must not be deleted)')
  failed++
} else {
  console.log('OK federation e2e module present')
}
const fedMod = fs.readFileSync(
  path.join(repo, 'backend/src/federation/mod.rs'),
  'utf8',
)
if (!/\bmod e2e\b/.test(fedMod)) {
  console.error('FAIL: federation/mod.rs must declare mod e2e')
  failed++
} else {
  console.log('OK federation/mod.rs declares e2e')
}

const configRs = fs.readFileSync(path.join(repo, 'backend/src/config.rs'), 'utf8')
if (!configRs.includes('fn test_app_config_defaults')) {
  console.error('FAIL: config.rs missing wired unit test test_app_config_defaults')
  failed++
} else {
  console.log('OK config.rs hosts test_app_config_defaults')
}

const brewConstants = fs.readFileSync(
  path.join(repo, 'frontend/src/components/brew/constants.ts'),
  'utf8',
)
for (const bad of [
  'SIZE_ORDER',
  'RESIZE_THRESHOLD',
  'SPRING_SNAPPY',
  'export function isBase64Image',
  'export function getBase64Info',
]) {
  if (brewConstants.includes(bad)) {
    console.error(`FAIL: brew/constants.ts still has dead symbol ${bad}`)
    failed++
  }
}
if (!brewConstants.includes('export function getShortContentText')) {
  console.error('FAIL: brew/constants.ts lost live getShortContentText')
  failed++
} else {
  console.log('OK brew/constants.ts cleaned; getShortContentText remains')
}

const modesConstants = fs.readFileSync(
  path.join(repo, 'frontend/src/components/brew/manager/modes/constants.ts'),
  'utf8',
)
if (
  modesConstants.includes('isBase64Image') ||
  modesConstants.includes('SORT_OPTIONS')
) {
  console.error('FAIL: modes/constants.ts still has dead base64/SORT_OPTIONS')
  failed++
} else {
  console.log('OK modes/constants.ts cleaned')
}

const readerConstants = fs.readFileSync(
  path.join(repo, 'frontend/src/components/brew/reader/constants.ts'),
  'utf8',
)
if (
  readerConstants.includes('TRANSITION_FAST') ||
  readerConstants.includes('STYLE_TRANSFORM_ORIGIN')
) {
  console.error('FAIL: reader/constants.ts still has unused transition/style exports')
  failed++
} else {
  console.log('OK reader/constants.ts cleaned')
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll dead-code removal assertions passed')
