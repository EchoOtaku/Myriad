import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Keep eager CSS in HTML; Vite's dynamic-import preloader owns lazy CSS. */
export function deferNonCriticalCssIntegration() {
  const chunks = new Map()
  let clientBuild = false
  const plugin = {
    name: 'collect-css-dependencies',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      clientBuild = !config.build.ssr
    },
    generateBundle(_options, bundle) {
      if (!clientBuild) return
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue
        chunks.set(file, {
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          css: [...(chunk.viteMetadata?.importedCss ?? [])],
        })
      }
    },
  }

  function stylesFor(roots, includeDynamic) {
    const seen = new Set()
    const css = new Set()
    const pending = [...roots]
    while (pending.length) {
      const file = pending.pop()
      if (seen.has(file)) continue
      seen.add(file)
      const chunk = chunks.get(file)
      if (!chunk) continue
      for (const style of chunk.css) css.add(style)
      pending.push(...chunk.imports)
      if (includeDynamic) pending.push(...chunk.dynamicImports)
    }
    return css
  }

  return {
    name: 'defer-non-critical-css',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({ vite: { plugins: [plugin] } })
      },
      'astro:build:done': ({ dir }) => {
        const outDir = fileURLToPath(dir)
        let removed = 0
        for (const entry of readdirSync(outDir, { recursive: true })) {
          if (!entry.endsWith('.html')) continue
          const htmlPath = path.join(outDir, entry)
          const html = readFileSync(htmlPath, 'utf8')
          const assetName = (href) => {
            if (/^(?:[a-z]+:|\/\/)/i.test(href)) return null
            const pathname = href.split(/[?#]/)[0]
            return pathname.startsWith('/')
              ? pathname.slice(1)
              : path.relative(outDir, path.resolve(path.dirname(htmlPath), pathname))
          }
          const roots = [...html.matchAll(/(?:src|component-url|renderer-url)=["']([^"']+\.js(?:[?#][^"']*)?)["']/g)]
            .map((match) => assetName(match[1]))
          const eager = stylesFor(roots, false)
          const reachable = stylesFor(roots, true)
          const next = html.replace(/<link\b[^>]*>/gi, (tag) => {
            if (!/\brel=["']stylesheet["']/i.test(tag)) return tag
            const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]
            const file = href && assetName(href)
            // Unknown assets (including Astro's document CSS) remain untouched.
            if (!reachable.has(file) || eager.has(file)) return tag
            removed++
            return ''
          })
          if (next !== html) writeFileSync(htmlPath, next)
        }
        console.log(`[defer-non-critical-css] deferred ${removed} lazy stylesheet link(s)`)
      },
    },
  }
}
