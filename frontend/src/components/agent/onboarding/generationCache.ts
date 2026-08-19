const PREFIX = 'myriad_persona_ob_'

export function generationCacheKey(kind: string, parts: string[]): string {
  return `${PREFIX}${kind}:${parts.join('|')}`
}

export function getGenerationCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function setGenerationCache<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function clearGenerationCache(kind?: string) {
  if (typeof window === 'undefined') return
  const prefix = kind ? `${PREFIX}${kind}:` : PREFIX
  const keys: string[] = []
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) sessionStorage.removeItem(key)
}
