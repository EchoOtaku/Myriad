import { useEffect, useState } from 'react'
import { displayImageUrl } from '../components/phantasi/notes/noteImageUrl'
import { fetchMediaObjectUrl, isPrivateMediaPath } from '../services/mediaApi'

/** Own the preview URL for exactly one source and release it on replacement. */
export function useMediaSource(source?: string): string | undefined {
  const [loaded, setLoaded] = useState<{ source?: string; url?: string }>({ source })
  if (loaded.source !== source) setLoaded({ source })
  const privateMedia = !!source && isPrivateMediaPath(source)
  useEffect(() => {
    if (!source || !privateMedia) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    fetchMediaObjectUrl(source, controller.signal)
      .then((url) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setLoaded({ source, url })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ source })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source, privateMedia])
  if (!source) return undefined
  if (!privateMedia) return displayImageUrl(source)
  return loaded.source === source ? loaded.url : undefined
}
