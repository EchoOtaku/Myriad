const DEFAULT_TITLE = 'Myriad - A myriad of lights, in one place.'
const DEFAULT_DESC =
  'Myriad is a self-hosted personal digital-life homepage for aggregating, organizing, and presenting data from multiple platforms.'

const CHROME = {
  'zh-CN': {
    title: 'Myriad - 万千灯火，汇于一处。',
    description:
      'Myriad 是自托管的个人数字生活主页，用来聚合、整理并展示多个平台的数据。',
    noscript: '请启用 JavaScript 以加载完整的交互式个人主页。',
  },
  'zh-TW': {
    title: 'Myriad - 萬千燈火，匯於一處。',
    description:
      'Myriad 是自託管的個人數位生活首頁，用來聚合、整理並展示多個平臺的資料。',
    noscript: '請啟用 JavaScript 以載入完整的互動式個人首頁。',
  },
  'ja-JP': {
    title: 'Myriad - 無数の灯を、ひとところに。',
    description:
      'Myriad は、複数プラットフォームのデータを集約・整理・公開するためのセルフホスト個人ホームページです。',
    noscript:
      'インタラクティブなホームページを表示するには JavaScript を有効にしてください。',
  },
  'en-US': {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    noscript: 'Enable JavaScript to load the full interactive homepage.',
  },
} as const

function sharedParserSource(source: string): string {
  return source
    .replace(/^\/\*\*[\s\S]*?\*\/\s*/u, '')
    .replaceAll(/^export /gm, '')
}

/** Inline first-paint boot. Uses the same parser as `locales.ts`. */
export function localeLangInlineScript(sharedSource: string): string {
  const chromeJson = JSON.stringify(CHROME)
  return `(function () {
  try {
    ${sharedParserSource(sharedSource)}
    var DEFAULT_TITLE = ${JSON.stringify(DEFAULT_TITLE)};
    var DEFAULT_DESC = ${JSON.stringify(DEFAULT_DESC)};
    var CHROME = ${chromeJson};
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

export const LOCALE_LANG_DEFAULT_TITLE = DEFAULT_TITLE
export const LOCALE_LANG_DEFAULT_DESC = DEFAULT_DESC
