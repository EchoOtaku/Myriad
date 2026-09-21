import { useMediaSource } from '../../../hooks/useMediaSource'

export function AuthenticatedMedia({
  src,
  video = false,
  className,
}: {
  src?: string
  video?: boolean
  className?: string
}) {
  const resolved = useMediaSource(src)
  if (!resolved) return <span className={`${className ?? ''} is-empty`} />
  if (video) {
    return <video className={className} src={resolved} muted playsInline preload="metadata" />
  }
  return <img className={className} src={resolved} alt="" />
}
