import { useState } from 'react'

export function PreviewSampleImage({ src }: { src?: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  return src && src !== failedSrc ? (
    <img
      key={src}
      className="platform-data-preview-sample-cover"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <span className="platform-data-preview-sample-cover is-placeholder" aria-hidden />
  )
}
