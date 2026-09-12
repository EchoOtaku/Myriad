import en from './en-US.json'
import ja from './ja-JP.json'
import zh from './zh-CN.json'
import tw from './zh-TW.json'

const CHROME = {
  'zh-CN': zh.chrome,
  'zh-TW': tw.chrome,
  'ja-JP': ja.chrome,
  'en-US': en.chrome,
} as const

export const LOCALE_LANG_DEFAULT_TITLE = en.chrome.title
export const LOCALE_LANG_DEFAULT_DESC = en.chrome.description

function sharedParserSource(source: string): string {
  return source
    .replace(/^\/\*\*[\s\S]*?\*\/\s*/u, '')
    .replaceAll(/^export /gm, '')
}

/** Inline first-paint boot. Parser + chrome both come from shared sources. */
export function localeLangInlineScript(sharedSource: string): string {
  return `(function () {
  try {
    ${sharedParserSource(sharedSource)}
    var DEFAULT_TITLE = ${JSON.stringify(LOCALE_LANG_DEFAULT_TITLE)};
    var DEFAULT_DESC = ${JSON.stringify(LOCALE_LANG_DEFAULT_DESC)};
    var CHROME = ${JSON.stringify(CHROME)};
    var stored = null;
    try { stored = localStorage.getItem('locale'); } catch (e) {}
    var cookie = typeof document !== 'undefined' ? document.cookie : '';
    var navList =
      (typeof navigator !== 'undefined' && navigator.languages && navigator.languages.join(','))
      || (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage))
      || '';
    var lang = resolveHostLocale(stored, parseLocaleCookie(cookie), navList);
    document.documentElement.lang = htmlLang(lang);
    var chrome = CHROME[lang] || CHROME['en-US'];
    var titleEl = document.querySelector('title');
    if (titleEl && (!titleEl.textContent || titleEl.textContent === DEFAULT_TITLE)) {
      titleEl.textContent = chrome.title;
    }
    var descEl = document.getElementById('meta-description');
    if (descEl && (!descEl.getAttribute('content') || descEl.getAttribute('content') === DEFAULT_DESC)) {
      descEl.setAttribute('content', chrome.description);
    }
    var noscriptEl = document.getElementById('noscript-enable-js');
    if (noscriptEl) noscriptEl.textContent = chrome.noscript;
  } catch (e) {}
})();`
}
