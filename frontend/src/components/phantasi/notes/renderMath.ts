import type { KatexOptions } from 'katex'
import katex from 'katex'
import {
  splitBareTex,
  unwrapMathDelimiters,
} from './noteMath'
import 'katex/contrib/mhchem'

export const MATH_SKIP_SELECTOR =
  '.math, .katex, .note-math, .note-math-edit, .notion-equation, .notion-inline-equation'

const HOST_SELECTOR =
  '.math, .note-math, .notion-equation, .notion-inline-equation'

const PROMOTE_SKIP = `${MATH_SKIP_SELECTOR}, pre, code, .note-widget, script, style, button`

const KATEX_OPTIONS: KatexOptions = {
  throwOnError: false,
  errorColor: '#c2410c',
  strict: 'ignore',
  trust: false,
  output: 'html',
  maxSize: 20,
  maxExpand: 1000,
}

function isDisplayHost(el: HTMLElement): boolean {
  return (
    el.classList.contains('math-display') ||
    el.classList.contains('note-math-display') ||
    el.classList.contains('notion-equation') ||
    el.classList.contains('katex-display')
  )
}

function readTex(el: HTMLElement): string {
  const attr = el.getAttribute('data-tex')
  if (attr != null && attr !== '') return attr
  return unwrapMathDelimiters(el.textContent ?? '').tex
}

function promoteBareTex(root: HTMLElement, visualIslands: boolean): void {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.data.includes('$')) continue
    if (node.parentElement?.closest(PROMOTE_SKIP)) continue
    nodes.push(node)
  }
  for (const node of nodes) {
    const pieces = splitBareTex(node.data)
    if (pieces.length === 1 && pieces[0]?.kind === 'text') continue
    const frag = doc.createDocumentFragment()
    for (const piece of pieces) {
      if (piece.kind === 'text') {
        frag.append(piece.value)
        continue
      }
      const el = doc.createElement(piece.display && visualIslands ? 'div' : 'span')
      if (visualIslands) {
        el.className = piece.display
          ? 'note-math note-math-display'
          : 'note-math note-math-inline'
        el.contentEditable = 'false'
      } else {
        el.className = piece.display ? 'math math-display' : 'math math-inline'
        el.textContent = piece.value
      }
      el.dataset.tex = piece.value
      frag.append(el)
    }
    node.replaceWith(frag)
  }
}

function decorateCopyTex(root: HTMLElement, copyLabel: string): void {
  for (const host of root.querySelectorAll<HTMLElement>(
    '.math-display, .note-math-display, .notion-equation',
  )) {
    if (host.closest('.note-widget')) continue
    if (host.parentElement?.classList.contains('math-copy-wrap')) continue
    const tex = readTex(host)
    if (!tex) continue
    const wrap = host.ownerDocument.createElement('div')
    wrap.className = 'math-copy-wrap'
    host.parentNode?.insertBefore(wrap, host)
    wrap.appendChild(host)
    const btn = host.ownerDocument.createElement('button')
    btn.type = 'button'
    btn.className = 'math-copy-tex'
    btn.title = copyLabel
    btn.textContent = copyLabel
    btn.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      try {
        await navigator.clipboard.writeText(tex)
        btn.dataset.copied = '1'
        window.setTimeout(() => {
          delete btn.dataset.copied
        }, 1600)
      } catch {
        /* 读路径已经有统一的剪贴板失败提示；这里不打断阅读。 */
      }
    })
    wrap.appendChild(btn)
  }
}

export function renderTexToHtml(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    ...KATEX_OPTIONS,
    displayMode: display,
  })
}

/** 可视层：裸 `$` 也收成可点的岛，回写 Markdown 才认。 */
export function hydrateVisualMath(root: HTMLElement): void {
  hydrateMath(root, undefined, 'visual')
}

/** 预览、阅读器、可视层共用：把语义公式排成 KaTeX。 */
export function hydrateMath(
  root: HTMLElement,
  copyLabel?: string,
  mode: 'read' | 'visual' = 'read',
): void {
  if (root.textContent?.includes('$')) promoteBareTex(root, mode === 'visual')
  for (const el of root.querySelectorAll<HTMLElement>(HOST_SELECTOR)) {
    if (el.closest('pre, code, .note-widget')) continue
    if (el.dataset.mathReady === '1') continue
    if (el.classList.contains('katex') || el.querySelector(':scope > .katex')) {
      el.dataset.mathReady = '1'
      continue
    }
    const tex = readTex(el)
    if (!tex) continue
    katex.render(tex, el, {
      ...KATEX_OPTIONS,
      displayMode: isDisplayHost(el),
    })
    el.dataset.mathReady = '1'
  }
  if (copyLabel) decorateCopyTex(root, copyLabel)
}
