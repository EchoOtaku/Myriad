import type {
  ImportedRigAsset,
  RigAssetCompileEvent,
  RigAssetPreflight,
} from './compiler'
import { importCompanionRig, previewCompanionRigImport } from '../api'
import { prepareRigPsdImport } from '../rig/psdImporter'
import {
  compileRigAsset,
  persistRigAsset,
  preflightRigAsset,
} from './compiler'

export type {
  ImportedRigAsset,
  RigAssetCompileEvent,
  RigAssetPreflight,
} from './compiler'

/** PSD parsing, atlas packing, validation, and upload form one transaction. */
export async function importRigPsdAsset(
  file: File,
  sourceMasterAssetId: string,
  dependencies: {
    prepare?: typeof prepareRigPsdImport
    preview?: typeof previewCompanionRigImport
    upload?: typeof importCompanionRig
    onStage?: (event: RigAssetCompileEvent) => void
  } = {},
  sourceGenerationFingerprint?: string,
): Promise<ImportedRigAsset> {
  return compileRigAsset(
    file,
    sourceMasterAssetId,
    {
      prepare: dependencies.prepare || prepareRigPsdImport,
      preview: dependencies.preview || previewCompanionRigImport,
      upload: dependencies.upload || importCompanionRig,
    },
    dependencies.onStage,
    sourceGenerationFingerprint,
  )
}

export async function preflightRigPsdAsset(
  file: File,
  sourceMasterAssetId: string,
  onStage?: (event: RigAssetCompileEvent) => void,
  sourceGenerationFingerprint?: string,
): Promise<RigAssetPreflight> {
  return preflightRigAsset(
    file,
    sourceMasterAssetId,
    { prepare: prepareRigPsdImport, preview: previewCompanionRigImport },
    onStage,
    sourceGenerationFingerprint,
  )
}

export async function commitRigPsdAsset(
  preflight: RigAssetPreflight,
  onStage?: (event: RigAssetCompileEvent) => void,
): Promise<ImportedRigAsset> {
  return persistRigAsset(preflight, importCompanionRig, onStage)
}
