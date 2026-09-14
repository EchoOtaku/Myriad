/** 不碰 ZIP。 */

import type { PhantasiSource } from '../../../types/phantasi'
import type { ImportProgress } from './modes/types'

import { formatMessage, getDefaultLocale } from '../../../i18n'
import * as phantasiApi from '../../../services/phantasiApi'
import { userFacingError } from '../../../utils/userFacingError'
import {
  buildPipackManifest,
  categoryToPackEntry,
  dataImageInfo,
  isDataImageUrl,
  normalizePipackUrl,
  parsePipackManifest,
  resolvePackIcon,
  rsshubInstanceToPackEntry,
  sourceAddPayload,
  sourceToPackEntry,
  sourceUpdatePayload,
} from './pipack'

function fill(
  template: string,
  params: Record<string, string | number>,
): string {
  return formatMessage(getDefaultLocale(), template, params)
}

export interface PipackCopy {
  exportSuccess: string
  errorExportFailed: string
  importStepReading: string
  importStepUnzipping: string
  importStepParsing: string
  importStepImporting: string
  errorInvalidFormat: string
  importSuccess: string
  errorImportFailed: string
}

type PipackResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

async function loadJSZip() {
  const module = await import('jszip')
  return module.default
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportPipackFile(
  sources: PhantasiSource[],
  copy: Pick<PipackCopy, 'exportSuccess' | 'errorExportFailed'>,
  signal?: AbortSignal,
): Promise<PipackResult> {
  try {
    const [packCategories, packInstances, JSZip] = await Promise.all([
      phantasiApi.getCategories(undefined, signal ? { signal } : undefined),
      phantasiApi.listRsshubInstances(undefined, signal ? { signal } : undefined),
      loadJSZip(),
    ])
    if (signal?.aborted) {
      return { ok: false, error: copy.errorExportFailed }
    }
    const zip = new JSZip()
    const iconsFolder = zip.folder('icons')
    const manifestSources = []

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      let iconFile: string | null = null
      let iconUrl: string | null = null

      if (source.icon) {
        if (isDataImageUrl(source.icon)) {
          const { ext } = dataImageInfo(source.icon)
          iconFile = `icon_${i}.${ext}`
          iconsFolder?.file(iconFile, source.icon.split(',')[1], {
            base64: true,
          })
        } else {
          iconUrl = source.icon
        }
      }

      manifestSources.push(sourceToPackEntry(source, iconFile, iconUrl))
    }

    zip.file(
      'manifest.json',
      JSON.stringify(
        buildPipackManifest({
          sources: manifestSources,
          categories: packCategories.map(categoryToPackEntry),
          rsshubInstances: packInstances.map(rsshubInstanceToPackEntry),
        }),
        null,
        2,
      ),
    )

    if (signal?.aborted) {
      return { ok: false, error: copy.errorExportFailed }
    }
    downloadBlob(
      await zip.generateAsync({ type: 'blob' }),
      `phantasi-export-${new Date().toISOString().slice(0, 10)}.pipack`,
    )
    return {
      ok: true,
      message: fill(copy.exportSuccess, { count: sources.length }),
    }
  } catch {
    return { ok: false, error: copy.errorExportFailed }
  }
}

export async function importPipackFile(
  file: File,
  sources: PhantasiSource[],
  copy: PipackCopy,
  onProgress: (progress: ImportProgress | null) => void,
  signal?: AbortSignal,
): Promise<PipackResult> {
  onProgress({ step: copy.importStepReading, current: 0, total: 0 })
  try {
    onProgress({ step: copy.importStepUnzipping, current: 0, total: 0 })
    const JSZip = await loadJSZip()
    const zip = await JSZip.loadAsync(file)

    onProgress({ step: copy.importStepParsing, current: 0, total: 0 })
    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) throw new Error(copy.errorInvalidFormat)

    let parsed: unknown
    try {
      parsed = JSON.parse(await manifestFile.async('string'))
    } catch {
      throw new Error(copy.errorInvalidFormat)
    }

    const manifest = (() => {
      try {
        return parsePipackManifest(parsed)
      } catch {
        throw new Error(copy.errorInvalidFormat)
      }
    })()

    const existingCategories = await phantasiApi
      .getCategories(undefined, signal ? { signal } : undefined)
      .catch(() => [])
    for (const category of manifest.categories ?? []) {
      if (signal?.aborted) break
      const found = existingCategories.find((item) => item.name === category.name)
      try {
        if (found) {
          await phantasiApi.updateCategory(found.id, {
            icon: category.icon ?? undefined,
            color: category.color ?? undefined,
            sort_order: category.sort_order,
          })
        } else {
          const created = await phantasiApi.createCategory({
            name: category.name,
            icon: category.icon ?? undefined,
            color: category.color ?? undefined,
          })
          if (created?.id && category.sort_order !== 0) {
            await phantasiApi.updateCategory(created.id, {
              sort_order: category.sort_order,
            })
          }
        }
      } catch {
        // 分类失败不阻断源导入
      }
    }

    const existingInstances = await phantasiApi
      .listRsshubInstances(undefined, signal ? { signal } : undefined)
      .catch(() => [])
    for (const instance of manifest.rsshub_instances ?? []) {
      if (signal?.aborted) break
      const found = existingInstances.find(
        (item) =>
          normalizePipackUrl(item.url) === normalizePipackUrl(instance.url),
      )
      try {
        if (found) {
          await phantasiApi.updateRsshubInstance(found.id, {
            name: instance.name,
            priority: instance.priority,
            enabled: instance.enabled,
          })
        } else {
          const created = await phantasiApi.addRsshubInstance({
            name: instance.name,
            url: instance.url,
            priority: instance.priority,
          })
          if (!instance.enabled) {
            await phantasiApi.updateRsshubInstance(created.id, { enabled: false })
          }
        }
      } catch {
        // 实例失败不阻断源导入
      }
    }

    const total = manifest.sources.length
    let imported = 0
    let skipped = 0

    for (let i = 0; i < manifest.sources.length; i++) {
      if (signal?.aborted) break
      const source = manifest.sources[i]
      onProgress({
        step: fill(copy.importStepImporting, { name: source.name }),
        current: i + 1,
        total,
      })

      try {
        if (sources.some((item) => item.url === source.url)) {
          skipped++
          continue
        }

        let zipIcon: string | undefined
        if (source.icon_file) {
          const iconFile = zip.file(`icons/${source.icon_file}`)
          if (iconFile) {
            const iconData = await iconFile.async('base64')
            const ext = source.icon_file.split('.').pop() || 'png'
            const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
            zipIcon = `data:${mimeType};base64,${iconData}`
          }
        }

        const icon = resolvePackIcon(source, zipIcon)
        const created = await phantasiApi.addSource(sourceAddPayload(source, icon))
        if (created?.id) {
          await phantasiApi.updateSource(
            created.id,
            sourceUpdatePayload(source, icon),
          )
        }
        imported++
      } catch {
        skipped++
      }
    }

    onProgress(null)
    return {
      ok: true,
      message: fill(copy.importSuccess, { imported, skipped }),
    }
  } catch (err) {
    onProgress(null)
    return {
      ok: false,
      error: userFacingError(err, copy.errorImportFailed),
    }
  }
}

export async function exportOpmlFile(signal?: AbortSignal): Promise<void> {
  const opml = await phantasiApi.exportOpml(
    undefined,
    signal ? { signal } : undefined,
  )
  if (signal?.aborted) return
  downloadBlob(
    new Blob([opml], { type: 'text/xml' }),
    `phantasi-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`,
  )
}
