import { useEffect, useState } from 'react'
import { fetchMediaObjectUrl, isPrivateMediaPath } from '../../../services/mediaApi'
import { displayImageUrl } from '../notes/noteImageUrl'

export function AuthenticatedMedia({
  src,
  video = false,
  className,
}: {
  src?: string
  video?: boolean
  className?: string
}) {
  const [resolved, setResolved] = useState<string | undefined>(() =>
    src && !isPrivateMediaPath(src) ? displayImageUrl(src) : undefined,
  )
  useEffect(() => {
    if (!src) {
      setResolved(undefined)
      return
    }
    if (!isPrivateMediaPath(src)) {
      setResolved(displayImageUrl(src))
      return
    }
    const ac = new AbortController()
    let objectUrl: string | undefined
    fetchMediaObjectUrl(src, ac.signal)
      .then((url) => {
        objectUrl = url
        setResolved(url)
      })
      .catch(() => {
        if (!ac.signal.aborted) setResolved(undefined)
      })
    return () => {
      ac.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])
  if (!resolved) return <span className={`${className ?? ''} is-empty`} />
  if (video) {
    return <video className={className} src={resolved} muted playsInline preload="metadata" />
  }
  return <img className={className} src={resolved} alt="" />
}
