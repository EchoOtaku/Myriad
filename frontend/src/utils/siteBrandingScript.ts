import {
  SITE_BRAND_ELEMENT_ID,
  SITE_METADATA_CACHE_KEY,
} from './siteMetadataKeys.ts'

/** Inline first-paint boot. Must stay import-free in the emitted IIFE. */
export function siteBrandingInlineScript(): string {
  return `(function () {
  try {
    var meta = null;
    try {
      var el = document.getElementById(${JSON.stringify(SITE_BRAND_ELEMENT_ID)});
      var docRaw = el && el.textContent ? el.textContent.trim() : '';
      if (docRaw && docRaw !== '{}') meta = JSON.parse(docRaw);
    } catch (e) {}
    if (!meta) {
      var raw = null;
      try { raw = localStorage.getItem(${JSON.stringify(SITE_METADATA_CACHE_KEY)}); } catch (e) {}
      if (!raw) return;
      meta = JSON.parse(raw);
    }
    if (!meta || typeof meta !== 'object') return;
    var title = typeof meta.site_title === 'string' ? meta.site_title.trim() : '';
    if (title && title.length <= 500) document.title = title;
    var icon = typeof meta.site_favicon === 'string' ? meta.site_favicon.trim() : '';
    if (!icon || icon.length > 1500000) return;
    if (icon.indexOf('//') === 0) return;
    var safe = false;
    if (icon.charAt(0) === '/' && icon.charAt(1) !== '/') safe = true;
    else if (/^https?:\\/\\//i.test(icon)) safe = true;
    else if (/^data:image\\//i.test(icon)) safe = true;
    if (!safe) return;
    var favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.setAttribute('href', icon);
    var apple = document.querySelector('link[rel="apple-touch-icon"]');
    if (apple) apple.setAttribute('href', icon);
  } catch (e) {}
})();`
}
