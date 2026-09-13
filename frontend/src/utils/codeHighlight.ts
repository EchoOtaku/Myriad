/**
 * 代码块高亮：Prism 按需加载，只在页面上真有 `code.language-x` 时才拉。
 * 阅读器和手记预览共用；主题在 codeHighlight.css，跟着 html.dark 走。
 */

import './codeHighlight.css'

type Loader = () => Promise<unknown>

/** 语法别名 → Prism 语言名。 */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  kt: 'kotlin',
  rb: 'ruby',
  ps1: 'powershell',
  dockerfile: 'docker',
  golang: 'go',
}

/** 核心自带 markup / css / clike / javascript；其余按需加载。 */
const LOADERS: Record<string, Loader> = {
  bash: () => import('prismjs/components/prism-bash'),
  c: () => import('prismjs/components/prism-c'),
  cpp: () => import('prismjs/components/prism-cpp'),
  csharp: () => import('prismjs/components/prism-csharp'),
  dart: () => import('prismjs/components/prism-dart'),
  diff: () => import('prismjs/components/prism-diff'),
  docker: () => import('prismjs/components/prism-docker'),
  elixir: () => import('prismjs/components/prism-elixir'),
  go: () => import('prismjs/components/prism-go'),
  graphql: () => import('prismjs/components/prism-graphql'),
  haskell: () => import('prismjs/components/prism-haskell'),
  ini: () => import('prismjs/components/prism-ini'),
  java: () => import('prismjs/components/prism-java'),
  json: () => import('prismjs/components/prism-json'),
  jsx: () => import('prismjs/components/prism-jsx'),
  kotlin: () => import('prismjs/components/prism-kotlin'),
  lua: () => import('prismjs/components/prism-lua'),
  makefile: () => import('prismjs/components/prism-makefile'),
  markdown: () => import('prismjs/components/prism-markdown'),
  nginx: () => import('prismjs/components/prism-nginx'),
  perl: () => import('prismjs/components/prism-perl'),
  php: () => import('prismjs/components/prism-php'),
  powershell: () => import('prismjs/components/prism-powershell'),
  python: () => import('prismjs/components/prism-python'),
  r: () => import('prismjs/components/prism-r'),
  ruby: () => import('prismjs/components/prism-ruby'),
  rust: () => import('prismjs/components/prism-rust'),
  scala: () => import('prismjs/components/prism-scala'),
  scss: () => import('prismjs/components/prism-scss'),
  sql: () => import('prismjs/components/prism-sql'),
  swift: () => import('prismjs/components/prism-swift'),
  toml: () => import('prismjs/components/prism-toml'),
  tsx: () => import('prismjs/components/prism-tsx'),
  typescript: () => import('prismjs/components/prism-typescript'),
  yaml: () => import('prismjs/components/prism-yaml'),
  zig: () => import('prismjs/components/prism-zig'),
}

/** 有依赖的语法先装依赖，否则 Prism 会在加载时报错。 */
const DEPENDS: Record<string, string[]> = {
  cpp: ['c'],
  tsx: ['jsx', 'typescript'],
  scss: ['css'],
  php: ['markup'],
}

export function normalizeLanguage(raw: string): string {
  const lower = raw.trim().toLowerCase()
  return ALIASES[lower] ?? lower
}

let prismPromise: Promise<typeof import('prismjs')> | null = null
const loaded = new Map<string, Promise<void>>()

async function loadPrism() {
  prismPromise ??= import('prismjs').then((mod) => {
    const prism = (mod as { default?: typeof import('prismjs') }).default ?? mod
    // 组件文件靠全局 Prism 注册语法。
    ;(globalThis as { Prism?: unknown }).Prism = prism
    return prism
  })
  return prismPromise
}

async function loadLanguage(lang: string): Promise<boolean> {
  const prism = await loadPrism()
  if (prism.languages[lang]) return true
  const loader = LOADERS[lang]
  if (!loader) return false
  let pending = loaded.get(lang)
  if (!pending) {
    pending = (async () => {
      for (const dep of DEPENDS[lang] ?? []) await loadLanguage(dep)
      await loader()
    })()
    loaded.set(lang, pending)
  }
  await pending
  return Boolean(prism.languages[lang])
}

const LANG_CLASS = /\blanguage-([\w+#.-]+)/

/** 给容器里所有 `pre > code.language-x` 上色。已经上过的跳过。 */
export async function highlightCodeBlocks(root: ParentNode): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')].filter(
    (code) => !code.dataset.highlighted,
  )
  if (blocks.length === 0) return
  const prism = await loadPrism()
  await Promise.all(
    blocks.map(async (code) => {
      const lang = normalizeLanguage(LANG_CLASS.exec(code.className)?.[1] ?? '')
      if (!lang) return
      const ok = await loadLanguage(lang)
      if (!ok || !code.isConnected) return
      const grammar = prism.languages[lang]
      if (!grammar) return
      code.innerHTML = prism.highlight(code.textContent ?? '', grammar, lang)
      code.dataset.highlighted = lang
      code.closest('pre')?.classList.add('brew-code-highlight')
    }),
  )
}
