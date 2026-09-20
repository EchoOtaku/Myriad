/** Align with proxy/backend: document-level geolocation for weather. */
export const DOCUMENT_PERMISSIONS_POLICY =
  'geolocation=(self), microphone=(self), camera=()'

export const BACKEND_TARGET = 'http://127.0.0.1:1103'

export const STATIC_ASSET_PATTERN =
  /\.(?:js|mjs|cjs|css|map|png|webp|jpe?g|gif|svg|ico|woff2?|ttf|otf|json|webmanifest|txt|wasm|webm|mp3|mp4)$/i
