export interface MediaDimensions { width: number; height: number }

export function validMediaDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_777_216
}

export function resizedDimensions(axis: 'width' | 'height', value: number, source: MediaDimensions): MediaDimensions {
  return axis === 'width'
    ? { width: value, height: Math.max(1, Math.round(value * source.height / source.width)) }
    : { width: Math.max(1, Math.round(value * source.width / source.height)), height: value }
}

export async function resizeMediaImage(src: string, width: number, height: number): Promise<string> {
  if (!validMediaDimensions(width, height)) throw new Error('Invalid image dimensions')
  const response = await fetch(src, { credentials: 'include' })
  if (!response.ok) throw new Error('Unable to load image')
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to resize image')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } finally { bitmap.close() }
}
