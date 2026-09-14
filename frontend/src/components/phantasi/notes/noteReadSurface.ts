/**
 * 预览和阅读器共用的读路径装饰：图、外链、代码外壳、上色、iframe。
 * 不动正文小组件里面。目录和嵌入卡仍只在阅读器做。
 */

import { currentCopy } from '../../../i18n/localeCopy'
import { showError } from '../../../utils/toastManager'

const COPY_ICON =
  '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>'
const COPIED_ICON =
  '<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'

export function decorateNoteReadSurface(
  root: HTMLElement,
  copyCodeLabel: string,
): void {
  for (const img of root.querySelectorAll('img')) {
    if (img.closest('.note-widget, .phantasi-embed-card, .phantasi-embed-exempt')) continue
    if (img.dataset.sizeProcessed) continue
    img.dataset.sizeProcessed = 'true'
    img.classList.add('rounded-xl', 'h-auto', 'my-4', 'mx-auto', 'block')

    const handleImageLoad = () => {
      const ratio = img.naturalWidth / img.naturalHeight
      const isSquare = ratio >= 0.8 && ratio <= 1.25
      const isSmall = img.naturalWidth <= 200 && img.naturalHeight <= 200
      if (isSquare || isSmall) img.style.maxWidth = '35%'
    }

    if (img.complete && img.naturalWidth > 0) handleImageLoad()
    else img.addEventListener('load', handleImageLoad, { once: true })
  }

  for (const link of root.querySelectorAll('a')) {
    if (link.closest('.note-widget')) continue
    if ((link.getAttribute('href') ?? '').startsWith('#')) continue
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  }

  for (const pre of root.querySelectorAll('pre')) {
    if (pre.closest('.note-widget')) continue
    if (pre.parentElement?.classList.contains('code-block-wrapper')) continue

    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper relative group my-5'
    const lang = pre
      .querySelector('code')
      ?.className.match(/\blanguage-([\w+#.-]+)/)?.[1]
    if (lang) wrapper.dataset.lang = lang

    pre.parentNode?.insertBefore(wrapper, pre)
    wrapper.appendChild(pre)

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className =
      'absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 bg-white/10 hover:bg-white/20 text-white/60 hover:text-white/90'
    copyBtn.innerHTML = COPY_ICON
    copyBtn.title = copyCodeLabel
    copyBtn.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      try {
        await navigator.clipboard.writeText(pre.textContent || '')
        copyBtn.innerHTML = COPIED_ICON
        window.setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON
        }, 2000)
      } catch (err) {
        console.error('复制失败:', err)
        showError(currentCopy().errors.clipboardFailed)
      }
    })
    wrapper.appendChild(copyBtn)
  }

  void import('../../../utils/codeHighlight')
    .then(({ highlightCodeBlocks }) => highlightCodeBlocks(root))
    .catch((err) => {
      console.error('[note-read] highlight failed', err)
    })

  for (const iframe of root.querySelectorAll('iframe')) {
    if (
      iframe.closest(
        '.note-widget, .phantasi-embed-card, .phantasi-bilibili-embed, .rss-content-iframe-wrapper',
      )
    ) {
      continue
    }
    if (iframe.dataset.iframeWrapped) continue
    iframe.dataset.iframeWrapped = 'true'

    const src = iframe.src || iframe.getAttribute('src') || ''
    const isMusicEmbed =
      src.includes('music.163.com') ||
      src.includes('spotify.com') ||
      src.includes('xiami.com')

    const wrapper = document.createElement('div')
    wrapper.className = `my-5 rounded-xl overflow-hidden ${isMusicEmbed ? 'aspect-3/1' : 'aspect-video'}`

    iframe.removeAttribute('width')
    iframe.removeAttribute('height')
    iframe.classList.add('w-full', 'h-full', 'border-0')
    iframe.setAttribute('loading', 'lazy')

    iframe.parentNode?.insertBefore(wrapper, iframe)
    wrapper.appendChild(iframe)
  }
}
