/**
 * Self-hosted faces for Astro Fonts API, SpaDocument `<Font>`, and title UI.
 * No runtime Google Fonts CDN.
 */

/**
 * @typedef {'--font-inter' | '--font-qwitcher-grypen' | '--font-codystar' | '--font-henny-penny' | '--font-srisakdi' | '--font-fleur-de-leah' | '--font-league-script' | '--font-megrim' | '--font-silkscreen' | '--font-unifraktur-maguntia' | '--font-cinzel'} SiteFontCssVariable
 *
 * @typedef {{
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
  cssVariable: '--font-inter',
  weights: [400, 500, 600, 700],
  styles: ['normal'],
  fallbacks: [
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'sans-serif',
  ],
  preload: true,
}

export const SITE_TITLE_FONTS = [
  {
    id: 'qwitcher-grypen',
    name: 'Qwitcher Grypen',
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
    cssVariable: '--font-codystar',
    cssClass: 'title-font-codystar',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'henny-penny',
    name: 'Henny Penny',
    cssVariable: '--font-henny-penny',
    cssClass: 'title-font-henny-penny',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'srisakdi',
    name: 'Srisakdi',
    cssVariable: '--font-srisakdi',
    cssClass: 'title-font-srisakdi',
    weights: [700],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'fleur-de-leah',
    name: 'Fleur De Leah',
    cssVariable: '--font-fleur-de-leah',
    cssClass: 'title-font-fleur-de-leah',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['cursive'],
  },
  {
    id: 'league-script',
    name: 'League Script',
    cssVariable: '--font-league-script',
    cssClass: 'title-font-league-script',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['cursive'],
  },
  {
    id: 'megrim',
    name: 'Megrim',
    cssVariable: '--font-megrim',
    cssClass: 'title-font-megrim',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'silkscreen',
    name: 'Silkscreen',
    cssVariable: '--font-silkscreen',
    cssClass: 'title-font-silkscreen',
    weights: [700],
    styles: ['normal'],
    fallbacks: ['system-ui'],
  },
  {
    id: 'unifraktur-maguntia',
    name: 'UnifrakturMaguntia',
    cssVariable: '--font-unifraktur-maguntia',
    cssClass: 'title-font-unifraktur-maguntia',
    weights: [400],
    styles: ['normal'],
    fallbacks: ['serif'],
  },
  {
    id: 'cinzel',
    name: 'Cinzel',
    cssVariable: '--font-cinzel',
    cssClass: 'title-font-cinzel',
    weights: [700],
    styles: ['normal'],
    fallbacks: ['serif'],
  },
]

/** @type {SiteFont[]} */
export const SITE_FONTS = [SITE_BODY_FONT, ...SITE_TITLE_FONTS]
