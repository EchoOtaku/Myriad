/** Installed Tapp package resources, assets and export operations. */

import { API_URL } from '../../config'
import { apiRequest } from './TappHttpClient'

export async function getTappCode(tappId: string): Promise<string> {
  const response = await fetch(
    `${API_URL}/api/tapps/${encodeURIComponent(tappId)}/code`,
    { method: 'GET', credentials: 'include' },
  )
  if (!response.ok) {
    throw new Error(`Failed to get Tapp code: ${response.status}`)
  }
  return response.text()
}

export interface TappResources {
  code: string
  styles?: string
  widgetStyles?: string
  pageStyles?: string
  widgetCSS?: string
  pageCSS?: string
  widgetTemplates?: Record<string, Record<string, string>>
  pageTemplate?: string
  cssMode?: 'unified' | 'separated'
  i18n?: Record<string, unknown>
  pageModules?: Record<string, string>
  pageModuleOrder?: string[]
}

interface TappResourcesRaw {
  code: string
  styles?: string
  widget_styles?: string
  page_styles?: string
  widget_css?: string
  page_css?: string
  widget_templates?: Record<string, Record<string, string>>
  page_template?: string
  css_mode?: 'unified' | 'separated'
  i18n?: Record<string, unknown>
  page_modules?: Record<string, string>
  page_module_order?: string[]
}

/** Projection of installed package resources. Matches backend `mode` query. */
export type TappResourceMode = 'full' | 'widget' | 'page'

/**
 * Project a full resources payload down to a widget/page slice (local, no I/O).
 * Used when a full cache entry or code-only 404 fallback can satisfy a narrower request.
 */
export function projectTappResources(
  full: TappResources,
  mode: TappResourceMode,
): TappResources {
  if (mode === 'full') return full
  if (mode === 'widget') {
    const pageMarker = '// ========== Page Code =========='
    const pageIdx = full.code.indexOf(pageMarker)
    return {
      code: pageIdx === -1 ? full.code : full.code.slice(0, pageIdx).trimEnd(),
      styles: full.styles,
      widgetStyles: full.widgetStyles,
      widgetCSS: full.widgetCSS,
      widgetTemplates: full.widgetTemplates,
      cssMode: full.cssMode,
      i18n: full.i18n,
    }
  }
  // page — strip widget section if present
  const widgetMarker = '// ========== Widget Code =========='
  const pageMarker = '// ========== Page Code =========='
  let code = full.code
  const widgetIdx = code.indexOf(widgetMarker)
  if (widgetIdx !== -1) {
    const pageIdx = code.indexOf(pageMarker, widgetIdx)
    if (pageIdx !== -1) {
      code = `${code.slice(0, widgetIdx).trimEnd()}\n\n${code.slice(pageIdx)}`
    } else {
      code = code.slice(0, widgetIdx).trimEnd()
    }
  }
  return {
    code,
    styles: full.styles,
    pageStyles: full.pageStyles,
    pageCSS: full.pageCSS,
    pageTemplate: full.pageTemplate,
    cssMode: full.cssMode,
    i18n: full.i18n,
    pageModules: full.pageModules,
    pageModuleOrder: full.pageModuleOrder,
  }
}

export async function getTappResources(
  tappId: string,
  options?: { mode?: TappResourceMode },
): Promise<TappResources> {
  const requestedMode: TappResourceMode = options?.mode ?? 'full'
  const mode =
    options?.mode && options.mode !== 'full' ? options.mode : undefined
  const params = mode ? `?mode=${encodeURIComponent(mode)}` : ''
  const response = await fetch(
    `${API_URL}/api/tapps/${encodeURIComponent(tappId)}/resources${params}`,
    { method: 'GET', credentials: 'include' },
  )
  if (!response.ok) {
    if (response.status === 404) {
      // Legacy code-only endpoint returns the full package source — project/strip
      // for the requested mode so widget/page surfaces never receive foreign slices.
      const code = await getTappCode(tappId)
      return projectTappResources({ code }, requestedMode)
    }
    throw new Error(`Failed to get Tapp resources: ${response.status}`)
  }
  const raw: TappResourcesRaw = await response.json()
  return {
    code: raw.code,
    styles: raw.styles,
    widgetStyles: raw.widget_styles,
    pageStyles: raw.page_styles,
    widgetCSS: raw.widget_css,
    pageCSS: raw.page_css,
    widgetTemplates: raw.widget_templates,
    pageTemplate: raw.page_template,
    cssMode: raw.css_mode,
    i18n: raw.i18n,
    pageModules: raw.page_modules,
    pageModuleOrder: raw.page_module_order,
  }
}

export interface TappAssetPayload {
  path: string
  mimeType: string
  size: number
  base64: string
}

export async function getTappAsset(
  tappId: string,
  path: string,
): Promise<TappAssetPayload> {
  const params = new URLSearchParams({ path })
  return apiRequest(
    `/api/tapps/${encodeURIComponent(tappId)}/asset?${params.toString()}`,
  )
}

export async function exportTapp(tappId: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/tapps/${encodeURIComponent(tappId)}/export`,
    { credentials: 'include' },
  )
  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`)
  }

  const disposition = response.headers.get('Content-Disposition')
  let filename = `${tappId}.tapp`
  const match = disposition?.match(/filename="(.+)"/)
  if (match) {
    filename = match[1]
  }

  const blob = await response.blob()
  const downloadUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(downloadUrl)
}
