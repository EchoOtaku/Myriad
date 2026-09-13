import {
  SITE_BRAND_ELEMENT_ID,
  SITE_METADATA_CACHE_KEY,
} from '../utils/siteMetadataKeys'
import de from './de-DE.json' with { type: 'json' }
import en from './en-US.json' with { type: 'json' }
import fr from './fr-FR.json' with { type: 'json' }
import ja from './ja-JP.json' with { type: 'json' }
import ko from './ko-KR.json' with { type: 'json' }
import zh from './zh-CN.json' with { type: 'json' }
import tw from './zh-TW.json' with { type: 'json' }

const CHROME = {
  'zh-CN': zh.chrome,
  'zh-TW': tw.chrome,
  'ja-JP': ja.chrome,
  'en-US': en.chrome,
  'ko-KR': ko.chrome,
  'fr-FR': fr.chrome,
  'de-DE': de.chrome,
} as const

export const LOCALE_LANG_DEFAULT_TITLE = en.chrome.title
export const LOCALE_LANG_DEFAULT_DESC = en.chrome.description

function sharedParserSource(source: string): string {
  return source
    .replaceAll(/^\/\*\*[\s\S]*?\*\/\s*/gu, '')
    .replaceAll(/^export /gm, '')
}

/** Inline first-paint boot. Parser + chrome both come from shared sources. */
export function localeLangInlineScript(sharedSource: string): string {
  return `(function () {
  try {
    ${sharedParserSource(sharedSource)}
    const DEFAULT_TITLE = ${JSON.stringify(LOCALE_LANG_DEFAULT_TITLE)};
    const DEFAULT_DESC = ${JSON.stringify(LOCALE_LANG_DEFAULT_DESC)};
    const CHROME = ${JSON.stringify(CHROME)};
    let stored = null;
    try { stored = localStorage.getItem('locale'); } catch {}
    let cachedSiteTitle = '';
    try {
      const brandEl = document.getElementById(${JSON.stringify(SITE_BRAND_ELEMENT_ID)});
      const docRaw = brandEl && brandEl.textContent ? brandEl.textContent.trim() : '';
      if (docRaw && docRaw !== '{}') {
        const brand = JSON.parse(docRaw);
        if (brand && typeof brand.site_title === 'string') cachedSiteTitle = brand.site_title.trim();
      }
    } catch {}
    try {
      if (!cachedSiteTitle) {
        const raw = localStorage.getItem(${JSON.stringify(SITE_METADATA_CACHE_KEY)});
        if (raw) {
          const meta = JSON.parse(raw);
          if (meta && typeof meta.site_title === 'string') cachedSiteTitle = meta.site_title.trim();
        }
      }
    } catch {}
    const cookie = typeof document !== 'undefined' ? document.cookie : '';
    const navList =
      (typeof navigator !== 'undefined' && navigator.languages && navigator.languages.join(','))
      || (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage))
      || '';
    const lang = resolveHostLocale(stored, parseLocaleCookie(cookie), navList);
    document.documentElement.lang = htmlLang(lang);
    const chrome = CHROME[lang] || CHROME['en-US'];
    const titleEl = document.querySelector('title');
    if (
      titleEl &&
      !cachedSiteTitle &&
      (!titleEl.textContent || titleEl.textContent === DEFAULT_TITLE)
    ) {
      titleEl.textContent = chrome.title;
    }
    const descEl = document.getElementById('meta-description');
    if (descEl && (!descEl.getAttribute('content') || descEl.getAttribute('content') === DEFAULT_DESC)) {
      descEl.setAttribute('content', chrome.description);
    }
    const noscriptEl = document.getElementById('noscript-enable-js');
    if (noscriptEl) noscriptEl.textContent = chrome.noscript;
  } catch {}
})();`
}
