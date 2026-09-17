export const AGENT_ATTACH_MAX_COUNT = 4
export const AGENT_ATTACH_MAX_BYTES = 8 * 1024 * 1024
export const AGENT_ATTACH_TEXT_CHARS = 8000
export const AGENT_ATTACH_ACCEPT =
  'image/*,text/plain,text/markdown,text/csv,application/json,application/xml,text/xml,.txt,.md,.markdown,.csv,.json,.xml'

export interface AgentAttachment {
  id: string
  name: string
  mime: string
  size: number
  /** UI only; omitted from the request. */
  previewUrl?: string
  text?: string
}

export type AttachError = 'tooMany' | 'tooLarge' | 'unsupported'

const TEXT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
])

export function isAttachableFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  if (TEXT_TYPES.has(file.type)) return true
  return /\.(txt|md|markdown|csv|json|xml)$/i.test(file.name)
}

export function attachErrorFor(
  file: File,
  currentCount: number,
): AttachError | null {
  if (currentCount >= AGENT_ATTACH_MAX_COUNT) return 'tooMany'
  if (file.size > AGENT_ATTACH_MAX_BYTES) return 'tooLarge'
  if (!isAttachableFile(file)) return 'unsupported'
  return null
}

export async function fileToAttachment(file: File): Promise<AgentAttachment> {
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const mime = file.type || 'application/octet-stream'
  const base: AgentAttachment = {
    id,
    name: file.name,
    mime,
    size: file.size,
  }
  if (file.type.startsWith('image/')) {
    const previewUrl = await thumbnailDataUrl(file)
    return { ...base, previewUrl }
  }
  const raw = await file.text()
  const text = raw.slice(0, AGENT_ATTACH_TEXT_CHARS)
  return { ...base, text }
}

/** Decode a small bitmap, retain only the thumbnail, and release native pixels. */
async function thumbnailDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { resizeWidth: 384, resizeQuality: 'high' })
  try {
    const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image preview unavailable')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const preview = canvas.toDataURL('image/webp', 0.7)
    canvas.width = canvas.height = 0
    return preview
  } finally {
    bitmap.close()
  }
}

export function attachmentsForRequest(
  attachments: readonly AgentAttachment[],
): Array<{ name: string; mime: string; size: number; text?: string }> {
  return attachments.map(({ name, mime, size, text }) => ({
    name,
    mime,
    size,
    ...(text ? { text } : {}),
  }))
}

export async function collectAttachments(
  files: Iterable<File>,
  current: readonly AgentAttachment[],
): Promise<{ attachments: AgentAttachment[]; error: AttachError | null }> {
  const next = Iterator.from(current).toArray()
  let error: AttachError | null = null
  for (const file of files) {
    const err = attachErrorFor(file, next.length)
    if (err) {
      error ??= err
      continue
    }
    next.push(await fileToAttachment(file))
  }
  return { attachments: next, error }
}
