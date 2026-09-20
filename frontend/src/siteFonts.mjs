/**
 * Self-hosted faces shared by the document head and title UI.
 * No runtime Google Fonts CDN.
 */

/**
 * @typedef {'--font-inter' | '--font-qwitcher-grypen' | '--font-codystar' | '--font-henny-penny' | '--font-srisakdi' | '--font-fleur-de-leah' | '--font-league-script' | '--font-megrim' | '--font-silkscreen' | '--font-unifraktur-maguntia' | '--font-cinzel'} SiteFontCssVariable
 *
 * @typedef {{
 *   asset: string
 *   unicodeRange: string
 *   name: string
 *   cssVariable: SiteFontCssVariable
 *   weights: number[]
 *   styles: string[]
 *   fallbacks: string[]
 *   preload?: boolean | { weight: number, style: string }[]
 *   id?: string
 *   cssClass?: string
 * }} SiteFont
 */

export const SITE_BODY_FONT = {
  name: 'Inter',
  asset: '/fonts/site/inter-c940764593d0fe5d.woff2',
  unicodeRange:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  cssVariable: '--font-inter',
  weights: [400, 500, 600, 700],
  styles: ['normal'],
  fallbacks: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
  preload: true,
}

export const SITE_TITLE_FONTS = [
  {
    id: 'qwitcher-grypen',
    name: 'Qwitcher Grypen',
    asset: '/fonts/site/qwitcher-grypen-a798c92ee481c19e.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-qwitcher-grypen',
    cssClass: 'title-font-qwitcher-grypen',
    weights: [700],
    styles: ['normal'],
    fallbacks: ['cursive'],
    preload: [{ weight: 700, style: 'normal' }],
  },
  {
    id: 'codystar',
    name: 'Codystar',
    asset: '/fonts/site/codystar-c5179bbf0fbdcb43.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-codystar',
    cssClass: 'title-font-codystar',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'henny-penny',
    name: 'Henny Penny',
    asset: '/fonts/site/henny-penny-0ad48c76a30b1939.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-henny-penny',
    cssClass: 'title-font-henny-penny',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'srisakdi',
    name: 'Srisakdi',
    asset: '/fonts/site/srisakdi-84157d1c8fd18296.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-srisakdi',
    cssClass: 'title-font-srisakdi',
    weights: [700],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'fleur-de-leah',
    name: 'Fleur De Leah',
    asset: '/fonts/site/fleur-de-leah-2b80bef89008b34e.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-fleur-de-leah',
    cssClass: 'title-font-fleur-de-leah',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['cursive'],
  },
  {
    id: 'league-script',
    name: 'League Script',
    asset: '/fonts/site/league-script-dade9708a8bb70fa.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-league-script',
    cssClass: 'title-font-league-script',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['cursive'],
  },
  {
    id: 'megrim',
    name: 'Megrim',
    asset: '/fonts/site/megrim-8de53330a270db61.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-megrim',
    cssClass: 'title-font-megrim',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'silkscreen',
    name: 'Silkscreen',
    asset: '/fonts/site/silkscreen-30ad65d8dff39d91.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-silkscreen',
    cssClass: 'title-font-silkscreen',
    weights: [700],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'unifraktur-maguntia',
    name: 'UnifrakturMaguntia',
    asset: '/fonts/site/unifraktur-maguntia-d98f10104192ccb3.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-unifraktur-maguntia',
    cssClass: 'title-font-unifraktur-maguntia',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['serif'],
  },
  {
    id: 'cinzel',
    name: 'Cinzel',
    asset: '/fonts/site/cinzel-f266c0cab0426b50.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    cssVariable: '--font-cinzel',
    cssClass: 'title-font-cinzel',
    weights: [700],
    styles: ['normal'],
    fallbacks: ['serif'],
  },
]

/** @type {SiteFont[]} */
export const SITE_FONTS = [SITE_BODY_FONT, ...SITE_TITLE_FONTS]
