import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Astro/Vite emits lazy-route CSS as HTML <link>, which blocks FCP.
 * Strip non-shell styles from HTML and inject them when the owning JS chunk runs.
 * Keep tailwind / index / App on the first paint.
 */
export function deferNonCriticalCssIntegration() {
  /** @type {{ cssPrefix: string, jsPrefixes: string[] }[]} */
  const DEFER = [
    { cssPrefix: 'AraelPanel-', jsPrefixes: ['AraelPanel-'] },
    { cssPrefix: 'Config-', jsPrefixes: ['Config-'] },
    { cssPrefix: 'ConfigForm-', jsPrefixes: ['Config-'] },
    { cssPrefix: 'Setup-', jsPrefixes: ['Setup-'] },
    { cssPrefix: 'TappPlaygroundPage-', jsPrefixes: ['TappPlaygroundPage-'] },
    // Toast.css is owned by Toast.tsx; ToastContainer is sync in AppLayout, so
    // the chunk may be Toast-* or merged into App-*. Inject both (idempotent).
    { cssPrefix: 'Toast-', jsPrefixes: ['Toast-', 'App-'] },
    { cssPrefix: 'MusicPlayer-', jsPrefixes: ['MusicPlayer-'] },
  ]

  function cssInjectorSnippet(href) {
    return `(function(){try{var h=${JSON.stringify(href)};if(document.querySelector('link[href="'+h+'"]'))return;var l=document.createElement("link");l.rel="stylesheet";l.href=h;document.head.appendChild(l)}catch(e){}})();`
  }

  return {
    name: 'defer-non-critical-css',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const outDir = fileURLToPath(dir)
        const assetsDir = path.join(outDir, 'assets')
        let assetFiles = []
        try {
          assetFiles = readdirSync(assetsDir)
        } catch {
          return
        }

        const cssFiles = assetFiles.filter((f) => f.endsWith('.css'))
        const jsFiles = assetFiles.filter((f) => f.endsWith('.js'))

        /** @type {Map<string, string[]>} */
        const injectMap = new Map()
        /** @type {Set<string>} */
        const stripCss = new Set()

        for (const rule of DEFER) {
          const matchedCss = cssFiles.filter((f) =>
            f.startsWith(rule.cssPrefix),
          )
          for (const cssName of matchedCss) {
            stripCss.add(cssName)
            const href = `/assets/${cssName}`
            for (const jsPrefix of rule.jsPrefixes) {
              const matchedJs = jsFiles.filter((f) => f.startsWith(jsPrefix))
              for (const jsName of matchedJs) {
                const list = injectMap.get(jsName) || []
                if (!list.includes(href)) list.push(href)
                injectMap.set(jsName, list)
              }
            }
          }
        }

        for (const [jsName, hrefs] of injectMap) {
          const jsPath = path.join(assetsDir, jsName)
          const original = readFileSync(jsPath, 'utf8')
          if (
            hrefs.every(
              (h) =>
                original.includes(h) &&
                original.includes('createElement("link")'),
            )
          ) {
            // Vite may already inject; still prepend the idempotent snippet below.
          }
          const banner = hrefs.map(cssInjectorSnippet).join('')
          if (!original.startsWith('(function(){try{var h=')) {
            writeFileSync(jsPath, banner + original)
          }
        }

        const stripRe = new RegExp(
          `<link[^>]+href="/assets/(${[...stripCss]
            .map((s) => RegExp.escape(s))
            .join('|')})"[^>]*>`,
          'g',
        )

        let htmlCount = 0
        let removed = 0
        for (const name of readdirSync(outDir)) {
          if (!name.endsWith('.html')) continue
          const htmlPath = path.join(outDir, name)
          let html = readFileSync(htmlPath, 'utf8')
          const before = html
          html = html.replace(stripRe, () => {
            removed++
            return ''
          })
          if (html !== before) {
            writeFileSync(htmlPath, html)
            htmlCount++
          }
        }

        console.log(
          `[defer-non-critical-css] stripped ${removed} link(s) from ${htmlCount} html; injected into ${injectMap.size} js chunk(s)`,
        )
      },
    },
  }
}
