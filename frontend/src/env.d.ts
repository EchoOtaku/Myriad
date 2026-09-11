/// <reference path="../.astro/types.d.ts" />

/** Vite define */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly PUBLIC_API_URL: string
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
