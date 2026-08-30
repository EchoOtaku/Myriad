import type { MeropeRigManifest } from '../rig/types'
import type { RigAssetCompileEvent } from './compiler'
import assert from 'node:assert/strict'
import test from 'node:test'
import { persistRigAsset, preflightRigAsset } from './compiler'

const file = new File([new Uint8Array([1])], 'character.psd')
const manifest = {
  schemaVersion: 1,
  quality: 'layered-2d',
  canvas: { width: 1, height: 1 },
  textures: [],
  bones: [{ id: 'root', parent: null, pivot: { x: 0.5, y: 0.9 } }],
  parts: [],
} as MeropeRigManifest

test('rig compiler exposes the complete successful artifact DAG', async () => {
  const events: RigAssetCompileEvent[] = []
  const preflight = await preflightRigAsset(
    file,
    'master-asset',
    {
      prepare: async (_file, _assetId, onStage) => {
        onStage?.('validated')
        onStage?.('packing')
        return {
          atlas: new Blob(),
          analysisReference: new Blob(),
          source: {} as never,
          partCount: 12,
        }
      },
      preview: async () => manifest,
    },
    (event) => events.push(event),
  )
  const result = await persistRigAsset(
    preflight,
    async () => manifest,
    (event) => events.push(event),
  )
  assert.equal(result.manifest, manifest)
  assert.equal(result.partCount, 12)
  assert.equal(typeof result.report.score, 'number')
  assert.deepEqual(
    events.map(({ stage, status }) => `${stage}:${status}`),
    [
      'validate-source:started',
      'validate-source:completed',
      'pack-atlas:started',
      'pack-atlas:completed',
      'compile-preview:started',
      'compile-preview:completed',
      'analyze-capabilities:started',
      'analyze-capabilities:completed',
      'persist-manifest:started',
      'persist-manifest:completed',
    ],
  )
})

test('rig compiler marks persistence failure as terminal', async () => {
  const events: RigAssetCompileEvent[] = []
  const preflight = await preflightRigAsset(
    file,
    'master-asset',
    {
      prepare: async () => ({
        atlas: new Blob(),
        analysisReference: new Blob(),
        source: {} as never,
        partCount: 2,
      }),
      preview: async () => manifest,
    },
    (event) => events.push(event),
  )
  await assert.rejects(
    persistRigAsset(
      preflight,
      async () => {
        throw new Error('storage unavailable')
      },
      (event) => events.push(event),
    ),
    /storage unavailable/,
  )
  assert.deepEqual(events.at(-1), {
    stage: 'persist-manifest',
    status: 'failed',
    error: 'storage unavailable',
  })
})

test('preflight fully compiles and diagnoses without calling persistence', async () => {
  let persisted = false
  const prepared = {
    atlas: new Blob(),
    analysisReference: new Blob(),
    source: { sourceMasterAssetId: 'master-asset' } as never,
    partCount: 45,
  }
  const result = await preflightRigAsset(file, 'master-asset', {
    prepare: async () => prepared,
    preview: async () => manifest,
  })
  assert.equal(result.prepared, prepared)
  assert.equal(result.partCount, 45)
  assert.equal(persisted, false)
  await persistRigAsset(result, async () => {
    persisted = true
    return manifest
  })
  assert.equal(persisted, true)
})

test('preflight sends the imported PSD composition to one-shot vision analysis', async () => {
  const analysisReference = new Blob([new Uint8Array([7])], {
    type: 'image/png',
  })
  let receivedReference: Blob | undefined
  await preflightRigAsset(file, 'master-asset', {
    prepare: async () => ({
      atlas: new Blob(),
      analysisReference,
      source: { sourceMasterAssetId: 'master-asset' } as never,
      partCount: 1,
    }),
    preview: async (_source, _atlas, reference) => {
      receivedReference = reference
      return manifest
    },
  })

  assert.equal(receivedReference, analysisReference)
})

test('preflight carries analyzed playback profiles into the persisted source', async () => {
  const source = {
    anime25dPlayback: {
      kind: 'anime-2.5d-rig',
      version: 1,
      engine: 'Anime2.5DRig',
      engineUrl: 'https://github.com/852wa/Anime2.5DRig',
      license: 'MIT',
      copyright: 'Copyright (c) 2026 hakoniwa',
      pixelCanvas: { width: 100, height: 120 },
      layers: [],
      anchors: {},
    },
  }
  const analyzed = structuredClone(manifest)
  analyzed.anime25dPlayback = {
    ...source.anime25dPlayback,
    chestProfile: {
      version: 2,
      enabled: true,
      source: 'ai-vision',
      centerX: 50,
      centerY: 75,
      radiusX: 20,
      radiusY: 18,
      visibleScale: 0.7,
      motionScale: 1.05,
      frequencyScale: 0.96,
      supportScale: 0.35,
      garmentMotionScale: 0.8,
      confidence: 0.9,
    },
    shellProfile: {
      version: 1,
      source: 'anchor-derived',
      enabled: true,
      blend: 0.5,
      head: { centerX: 50, centerY: 35, radiusX: 25, radiusY: 30, radiusZ: 18 },
      faceProfile: {
        enabled: true,
        startY: 10,
        endY: 75,
        points: [
          { v: 0.06, z: 0.1 },
          { v: 0.42, z: 0.02 },
          { v: 0.62, z: 0.3 },
          { v: 0.78, z: 0.06 },
          { v: 0.97, z: 0.14 },
        ],
      },
      hair: {
        centerX: 50,
        centerY: 33,
        radiusX: 28,
        radiusY: 33,
        radiusZ: 19,
        frontGap: 0.18,
        frontBulge: 1,
        backDepth: 0.35,
        crownRound: 0,
        hairlinePin: {
          enabled: true,
          centerX: 0,
          centerY: -0.45,
          halfWidth: 1.1,
          halfHeight: 0.32,
          feather: 0.06,
        },
      },
      torso: {
        enabled: true,
        blend: 0.5,
        centerX: 50,
        radiusX: 40,
        radiusZ: 25,
      },
    },
  } as never
  const result = await preflightRigAsset(file, 'master-asset', {
    prepare: async () => ({
      atlas: new Blob(),
      analysisReference: new Blob(),
      source: source as never,
      partCount: 1,
    }),
    preview: async () => analyzed,
  })
  assert.deepEqual(
    result.prepared.source.anime25dPlayback?.chestProfile,
    analyzed.anime25dPlayback.chestProfile,
  )
  assert.deepEqual(
    result.prepared.source.anime25dPlayback?.shellProfile,
    analyzed.anime25dPlayback.shellProfile,
  )
  assert.notEqual(
    result.prepared.source.anime25dPlayback?.shellProfile,
    analyzed.anime25dPlayback.shellProfile,
  )
})

test('failed preview never produces anything to persist', async () => {
  const events: RigAssetCompileEvent[] = []
  await assert.rejects(
    preflightRigAsset(
      file,
      'master-asset',
      {
        prepare: async () => ({
          atlas: new Blob(),
          analysisReference: new Blob(),
          source: {} as never,
          partCount: 45,
        }),
        preview: async () => {
          throw new Error('semantic chain rejected')
        },
      },
      (event) => events.push(event),
    ),
    /semantic chain rejected/,
  )
  // 拿不到 preflight 就无从落库；阶段流里也不该出现落库这一步。
  assert.deepEqual(events.at(-1), {
    stage: 'compile-preview',
    status: 'failed',
    error: 'semantic chain rejected',
  })
  assert.equal(
    events.some((event) => event.stage === 'persist-manifest'),
    false,
  )
})
