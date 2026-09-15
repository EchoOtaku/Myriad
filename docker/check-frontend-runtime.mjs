#!/usr/bin/env node
/**
 * Fail if the frontend image runtime would miss a spa-server module.
 * Used by frontend unit tests and image-build workflows.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const SCRIPTS_ROOT = path.join(REPO_ROOT, 'frontend/scripts')
const SPA_SERVER = path.join(SCRIPTS_ROOT, 'spa-server.mjs')
const DOCKERFILE = path.join(HERE, 'Dockerfile.frontend')

const RELATIVE_IMPORT =
  /(?:import\s+(?:[^'"\n]+from\s+)?|export\s+[^'"\n]*from\s+|import\(\s*)['"](\.[^'"]+)['"]/g

export function walkRelativeImports(entry) {
  const seen = new Set()
  const queue = [path.resolve(entry)]
  while (queue.length > 0) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      queue.push(path.normalize(path.join(path.dirname(file), match[1])))
    }
  }
  return [...seen].sort()
}

export function checkFrontendRuntime() {
  const imported = walkRelativeImports(SPA_SERVER)
  assert.ok(imported.includes(SPA_SERVER), 'spa-server.mjs must be in the closure')

  const outside = imported.filter((file) => {
    const rel = path.relative(SCRIPTS_ROOT, file)
    return rel.startsWith('..') || path.isAbsolute(rel)
  })
  assert.deepEqual(
    outside,
    [],
    `spa-server imports files outside frontend/scripts (not in the image): ${outside
      .map((file) => path.relative(REPO_ROOT, file))
      .join(', ')}`,
  )

  const dockerfile = readFileSync(DOCKERFILE, 'utf8')
  const runtime = dockerfile.split(/FROM\s+[^\n]+AS runtime/)[1]
  assert.ok(runtime, 'Dockerfile.frontend must have a runtime stage')
  assert.match(
    runtime,
    /COPY(?:\s+--[\w-]+(?:=\S+)?)*\s+frontend\/scripts\/?\s+\.\/scripts\/?/,
    'runtime must COPY frontend/scripts ./scripts as a tree, not flatten files',
  )
  assert.match(
    runtime,
    /CMD\s+\["node", "scripts\/spa-server\.mjs"\]/,
    'runtime CMD must run scripts/spa-server.mjs so relative imports resolve',
  )
  assert.match(runtime, /ENV DIST_DIR=\/app\/dist/)
  assert.doesNotMatch(
    runtime,
    /wget --no-verbose/,
    'Alpine busybox wget has no --no-verbose; use wget -q',
  )

  const dockerignore = readFileSync(path.join(REPO_ROOT, '.dockerignore'), 'utf8')
  assert.doesNotMatch(
    dockerignore,
    /^\*\*\/scripts/m,
    '.dockerignore **/scripts would drop frontend/scripts from the image context',
  )
  assert.doesNotMatch(
    dockerignore,
    /^frontend\/scripts/m,
    '.dockerignore must not exclude frontend/scripts',
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkFrontendRuntime()
}
