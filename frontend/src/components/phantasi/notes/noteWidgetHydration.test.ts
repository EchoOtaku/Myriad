import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { WidgetComponentProps, WidgetType } from '../../widgetGridTypes'
import type { NoteWidgetHydration } from './noteWidgetMount.tsx'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, describe, it } from 'node:test'
import {
  act,
  createElement,
  Fragment,

  useLayoutEffect,
  useRef,
} from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { prepareNoteReaderHtml } from './noteImageUrl.ts'
import { noteWidgetInstanceId } from './noteWidgetId.ts'
import {

  replaceNoteHtml,
  useNoteWidgetHydration,
} from './noteWidgetMount.tsx'

const require = createRequire(import.meta.url)
const { JSDOM } = require(
  require.resolve('jsdom', {
    paths: [require.resolve('isomorphic-dompurify')],
  }),
)

function NavFace({ isEditMode }: WidgetComponentProps) {
  useNavigate()
  return createElement(
    'span',
    {
      'data-note-nav': '1',
      'data-edit': isEditMode ? '1' : '0',
    },
    'routed',
  )
}

const CATALOG: WidgetType[] = [
  {
    id: 'friend-links',
    name: 'Friends',
    defaultSize: '4x2',
    component: NavFace,
    supportedSizes: ['4x2'],
  },
  {
    id: 'report-bilibili',
    name: 'Bilibili',
    defaultSize: '4x2',
    component: NavFace,
    supportedSizes: ['4x2'],
  },
  {
    id: 'tapp-shortcut',
    name: 'Tapp',
    defaultSize: '1x1',
    component: NavFace,
    supportedSizes: ['1x1'],
  },
]

const THREE = `
<div class="note-widget" data-widget="friend-links" data-size="4x2"></div>
<div class="note-widget" data-widget="report-bilibili" data-size="4x2"></div>
<div class="note-widget" data-widget="tapp-shortcut" data-size="1x1"></div>
`

const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/phantasi' })
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: dom.window.document,
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: dom.window.localStorage,
})
for (const key of ['HTMLElement', 'Element', 'Node', 'DocumentFragment'] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  })
}
const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
globals.IS_REACT_ACT_ENVIRONMENT = true

function mountPoint(): HTMLElement {
  let el = dom.window.document.getElementById('root')
  if (!el) {
    el = dom.window.document.createElement('div')
    el.id = 'root'
    dom.window.document.body.appendChild(el)
  }
  return el
}

describe('useNoteWidgetHydration', () => {
  let root: Root | null = null

  afterEach(async () => {
    if (!root) return
    const current = root
    root = null
    await act(async () => {
      current.unmount()
    })
    mountPoint().replaceChildren()
  })

  after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as { window?: unknown }).window
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete (globalThis as { document?: unknown }).document
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    else delete (globalThis as { localStorage?: unknown }).localStorage
    delete globals.IS_REACT_ACT_ENVIRONMENT
  })

  it('友链 / 报告卡 / Tapp 从这棵树 portal 进去，有 Router 就不空白；选中只改 isEditMode', async () => {
    let hydration!: NoteWidgetHydration
    function Harness({ html, editable }: { html: string; editable: boolean }) {
      const ref = useRef<HTMLDivElement | null>(null)
      hydration = useNoteWidgetHydration(ref, CATALOG, html, true, { editable })
      return createElement(
        MemoryRouter,
        null,
        createElement(
          Fragment,
          null,
          createElement('div', {
            ref: (node: HTMLDivElement | null) => {
              ref.current = node
              if (node && node.childElementCount === 0) node.innerHTML = html
            },
          }),
          hydration.portals as ReactNode,
        ),
      )
    }

    root = createRoot(mountPoint())
    await act(async () => {
      root!.render(createElement(Harness, { html: THREE, editable: true }))
    })

    const hosts = [...dom.window.document.querySelectorAll('.note-widget')] as HTMLElement[]
    assert.equal(hosts.length, 3)
    assert.equal(dom.window.document.querySelectorAll('[data-note-nav]').length, 3)
    assert.equal(dom.window.document.querySelector('.note-widget__missing'), null)
    assert.deepEqual(
      hosts.map((host) => host.dataset.widget),
      ['friend-links', 'report-bilibili', 'tapp-shortcut'],
    )
    const firstId = noteWidgetInstanceId(hosts[0], 'friend-links')
    assert.match(firstId, /^note-friend-links-\d+$/)

    hosts[0].classList.add('is-selected')
    await act(async () => {
      hydration.refresh()
    })
    const edits = [...dom.window.document.querySelectorAll('[data-note-nav]')].map((node) =>
      node.getAttribute('data-edit'),
    )
    assert.deepEqual(edits, ['1', '0', '0'])
    assert.equal(noteWidgetInstanceId(hosts[0], 'friend-links'), firstId)

    await act(async () => {
      replaceNoteHtml(
        hosts[0].parentElement as HTMLElement,
        '<div class="note-widget" data-widget="friend-links" data-size="4x2"></div>',
      )
    })
    assert.equal(dom.window.document.querySelectorAll('.note-widget').length, 1)
    assert.equal(dom.window.document.querySelectorAll('[data-note-nav]').length, 1)
  })

  it('没有 Router 时落到 missing，不另开 MemoryRouter 硬撑', async () => {
    function Bare({ html }: { html: string }) {
      const ref = useRef<HTMLDivElement | null>(null)
      const hydration = useNoteWidgetHydration(ref, CATALOG, html, true)
      return createElement(
        Fragment,
        null,
        createElement('div', {
          ref: (node: HTMLDivElement | null) => {
            ref.current = node
            if (node && node.childElementCount === 0) node.innerHTML = html
          },
        }),
        hydration.portals as ReactNode,
      )
    }

    const prev = console.error
    console.error = () => {}
    try {
      root = createRoot(mountPoint())
      await act(async () => {
        root!.render(createElement(Bare, { html: THREE }))
      })
    } finally {
      console.error = prev
    }

    assert.equal(dom.window.document.querySelectorAll('.note-widget__missing').length, 3)
    assert.equal(dom.window.document.querySelector('[data-note-nav]'), null)
  })

  it('打字不重挂；预览根一直在，换 HTML 才 replaceNoteHtml 再补挂', async () => {
    let visual!: NoteWidgetHydration
    let preview!: NoteWidgetHydration
    const previewHtml = prepareNoteReaderHtml(THREE, '')

    function Editor({
      pane,
      visualHtml,
      visualEditing,
      previewSource,
    }: {
      pane: 'visual' | 'preview' | 'write'
      visualHtml: string
      visualEditing: boolean
      previewSource: string
    }) {
      const visualRef = useRef<HTMLDivElement | null>(null)
      const previewRef = useRef<HTMLDivElement | null>(null)
      const editing = useRef(visualEditing)
      editing.current = visualEditing

      useLayoutEffect(() => {
        if (pane !== 'visual') return
        const el = visualRef.current
        if (!el) return
        if (editing.current) {
          el.dataset.noteVisual = visualHtml
          return
        }
        if (el.dataset.noteVisual === visualHtml) return
        replaceNoteHtml(el, visualHtml)
        el.dataset.noteVisual = visualHtml
      }, [pane, visualHtml])

      useLayoutEffect(() => {
        if (pane !== 'preview') return
        const el = previewRef.current
        if (!el) return
        if (el.dataset.noteRead === previewSource) return
        replaceNoteHtml(el, previewSource)
        el.dataset.noteRead = previewSource
      }, [pane, previewSource])

      visual = useNoteWidgetHydration(visualRef, CATALOG, pane, pane !== 'preview', {
        editable: true,
      })
      preview = useNoteWidgetHydration(previewRef, CATALOG, pane, pane === 'preview')

      return createElement(
        MemoryRouter,
        null,
        createElement(
          Fragment,
          null,
          createElement('div', {
            'data-visual': '1',
            ref: (node: HTMLDivElement | null) => {
              visualRef.current = node
            },
          }),
          createElement('div', {
            'data-preview': '1',
            hidden: !previewSource,
            ref: (node: HTMLDivElement | null) => {
              previewRef.current = node
            },
          }),
          visual.portals as ReactNode,
          preview.portals as ReactNode,
        ),
      )
    }

    root = createRoot(mountPoint())
    await act(async () => {
      root!.render(
        createElement(Editor, {
          pane: 'visual',
          visualHtml: THREE,
          visualEditing: false,
          previewSource: '',
        }),
      )
    })

    const previewRoot = dom.window.document.querySelector('[data-preview]') as HTMLElement
    assert.ok(previewRoot)
    const firstHosts = [...dom.window.document.querySelectorAll('[data-visual] .note-widget')] as HTMLElement[]
    assert.equal(firstHosts.length, 3)
    assert.equal(dom.window.document.querySelectorAll('[data-note-nav]').length, 3)
    const firstId = noteWidgetInstanceId(firstHosts[0], 'friend-links')
    const firstNode = firstHosts[0]

    await act(async () => {
      root!.render(
        createElement(Editor, {
          pane: 'visual',
          visualHtml: `${THREE}<p>typed</p>`,
          visualEditing: true,
          previewSource: '',
        }),
      )
    })

    const still = [...dom.window.document.querySelectorAll('[data-visual] .note-widget')] as HTMLElement[]
    assert.equal(still[0], firstNode)
    assert.equal(noteWidgetInstanceId(still[0], 'friend-links'), firstId)
    assert.equal(dom.window.document.querySelectorAll('[data-note-nav]').length, 3)
    assert.equal(dom.window.document.querySelector('[data-visual] p'), null)

    const typed = `${THREE}<p>typed</p>`
    await act(async () => {
      root!.render(
        createElement(Editor, {
          pane: 'visual',
          visualHtml: typed,
          visualEditing: false,
          previewSource: '',
        }),
      )
    })
    assert.equal(
      [...dom.window.document.querySelectorAll('[data-visual] .note-widget')][0],
      firstNode,
    )

    await act(async () => {
      root!.render(
        createElement(Editor, {
          pane: 'write',
          visualHtml: typed,
          visualEditing: false,
          previewSource: '',
        }),
      )
    })
    assert.equal(
      [...dom.window.document.querySelectorAll('[data-visual] .note-widget')][0],
      firstNode,
    )
    assert.equal(dom.window.document.querySelectorAll('[data-visual] [data-note-nav]').length, 3)

    await act(async () => {
      root!.render(
        createElement(Editor, {
          pane: 'visual',
          visualHtml: typed,
          visualEditing: false,
          previewSource: '',
        }),
      )
    })
    assert.equal(
      [...dom.window.document.querySelectorAll('[data-visual] .note-widget')][0],
      firstNode,
    )
    assert.equal(noteWidgetInstanceId(firstNode, 'friend-links'), firstId)

    await act(async () => {
      root!.render(
        createElement(Editor, {
          pane: 'preview',
          visualHtml: THREE,
          visualEditing: false,
          previewSource: previewHtml,
        }),
      )
    })

    assert.equal(dom.window.document.querySelectorAll('[data-visual] [data-note-nav]').length, 0)
    const previewHosts = [...dom.window.document.querySelectorAll('[data-preview] .note-widget')] as HTMLElement[]
    assert.equal(previewHosts.length, 3)
    assert.equal(dom.window.document.querySelectorAll('[data-preview] [data-note-nav]').length, 3)
    assert.equal(dom.window.document.querySelector('[data-preview] .note-widget__missing'), null)
    assert.deepEqual(
      previewHosts.map((host) => host.dataset.widget),
      ['friend-links', 'report-bilibili', 'tapp-shortcut'],
    )
    assert.match(noteWidgetInstanceId(previewHosts[0], 'friend-links'), /^note-friend-links-\d+$/)
    assert.notEqual(noteWidgetInstanceId(previewHosts[0], 'friend-links'), firstId)

    previewHosts[1].classList.add('is-selected')
    await act(async () => {
      preview.refresh()
    })
    assert.deepEqual(
      [...dom.window.document.querySelectorAll('[data-preview] [data-note-nav]')].map((node) =>
        node.getAttribute('data-edit'),
      ),
      ['0', '0', '0'],
    )

    firstHosts[0].classList.add('is-selected')
    await act(async () => {
      visual.refresh()
    })
    assert.equal(dom.window.document.querySelectorAll('[data-visual] [data-note-nav]').length, 0)
  })
})
