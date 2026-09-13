/** Inline first-paint theme boot. Must stay import-free in the emitted IIFE. */
export function themeBootInlineScript(): string {
  return `(function () {
  try {
    var html = document.documentElement;
    var stored = null;
    try { stored = localStorage.getItem('theme'); } catch (e) {}
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
    if (theme === 'dark') {
      html.classList.add('dark');
      html.classList.remove('light');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
    }
    var updateThemeColor = function () {
      var primaryColor =
        getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#94a3b8';
      var metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', primaryColor);
      }
    };
    updateThemeColor();
    new MutationObserver(updateThemeColor).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      var current = null;
      try { current = localStorage.getItem('theme'); } catch (err) {}
      if (!current || current === 'auto') {
        var next = e.matches ? 'dark' : 'light';
        if (next === 'dark') {
          html.classList.add('dark');
          html.classList.remove('light');
        } else {
          html.classList.add('light');
          html.classList.remove('dark');
        }
        updateThemeColor();
      }
    });
  } catch (e) {}
})();`
}
