/** 预览与发布仍走后端渲染。可视层只改 Markdown 原文。 */

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import type { BrewNoteDoc } from '../../../types/brew'
import type { NoteCollabEvent, NoteCollabPeer } from './noteCollab'
import type { InlineLink } from './noteDraft'
import type {
  NoteEditorPane,
  NoteEditorTool,
  NoteInsertMenuState,
  TableAlign,
} from './NoteEditorChrome'
import type { SelectionAnchor } from './noteSelection'
import type { NoteCloudFields } from './useNoteCloudSave'
import {
  LuBold as Bold,
  LuBookOpen as BookOpen,
  LuCheckSquare as CheckSquare,
  LuCode as Code,
  LuColumns2 as Columns2,
  LuFileText as FileText,
  LuImage as Image,
  LuImagePlus as ImagePlus,
  LuItalic as Italic,
  LuLink as Link,
  LuList as List,
  LuListOrdered as ListOrdered,
  LuMinus as Minus,
  LuPuzzle as Puzzle,
  LuQuote as Quote,
  LuSquareCode as SquareCode,
  LuStrikethrough as Strikethrough,
} from '@lib/icons'

import { motionShim as motion } from '@lib/motionShim'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useI18n } from '../../../contexts/I18nContext'
import { brewAnimationPresets, getBrewTransition, useBrewAnimationConfig } from '../../../hooks/animation/pages/brew'
import { isExlight } from '../../../hooks/useAnimationLevel'
import * as brewApi from '../../../services/brewApi'
import { federationApi } from '../../../services/federationApi'
import { userFacingError } from '../../../utils/userFacingError'
import { Spinner } from '../../Spinner'
import { showNoteNotice } from '../brewNotice'
import { BREW_MINE_CATEGORY } from '../constants'
import {
  collectNoteCategories,
  normalizeNoteCategory,
} from './noteCategory'
import {
  applyCollabPeers,

  shouldApplyRemoteDoc,
  shouldApplyRemoteEdit,
} from './noteCollab'
import {
  clearNoteDraft,
  draftDiffersFrom,
  hardBreak,
  indentLines,
  linkAtCursor,
  openLineBelow,
  prefixLines,
  pruneOrphanFootnotes,
  readNoteDraft,
  replaceLink,
  setHeadingLevel,
  toggleWrap,
  wrapSelection,
  writeNoteDraft,
} from './noteDraft'
import {
  NoteBlockBar,
  NoteBubble,
  NoteByline,
  NoteFootBar,
  NoteGutter,
  NoteSettingsDrawer,
  NoteTopBar,
  peerHue,
  splitNoteTools,
} from './NoteEditorChrome'
import {
  countNoteChars,
  firstMarkdownImage,
  MAX_NOTE_BODY_CHARS,
  MAX_NOTE_TITLE_CHARS,
  normalizeNoteCover,
  normalizeNoteTopic,
  noteFieldError,
  noteScheduleError,
  sameNoteMinute,
  toNoteWritePayload,
} from './noteFields'
import { displayImageUrl, prepareNoteReaderHtml } from './noteImageUrl'
import { matchEnterRule, matchSpaceRule } from './noteInputRules'
import { caretOffsetStyle } from './noteMerge'
import { blockSourceRange, previewClickToMarkdownIndex } from './notePreviewEdit'
import {
  anchorInContainer,
  growTextarea,
  lineIsBlank,
  textareaSupportsFieldSizing,
  visualEmptyLineRect,
} from './noteSelection'
import {
  applyInlineMarkdownAtCaret,
  applyVisualInputRule,
  blockIndexAt,
  columnsAddColumn,
  columnsRemove,
  columnsRemoveColumn,
  currentColumnAlign,
  insertColumnsMarkdown,
  insertColumnsVisual,
  insertFootnoteMarkdown,
  insertImage,
  insertTableMarkdown,
  insertWidgetMarkdown,
  insertWidgetVisual,
  expandJammedDefinitions,
  looksLikeMarkdown,
  markdownToVisualHtml,
  pasteMarkdownIntoVisual,
  placeCaretAtTextOffset,
  removeImage,
  removeNoteWidget,
  runVisualCommand,
  setNoteWidgetConfig,
  setNoteWidgetSize,
  setImageAlt,
  setImageSrc,
  setCodeLang as setVisualCodeLang,
  setVisualImageResolver,
  tableAddColumn,
  tableAddRow,
  tableRemove,
  tableRemoveColumn,
  tableRemoveRow,
  tableSetAlign,
  tableStep,
  textBeforeCaret,
  toggleVisualHeading,
  toggleVisualInlineCode,
  toggleVisualTask,
  visualBlockAt,
  visualClosest,
  visualClosestClass,
  visualHtmlToMarkdown,
  visualOpenBlockBelow,
} from './noteVisual'
import {
  decodeWidgetConfigAttr,
  NOTE_WIDGET_SIZES,
  noteWidgetCanConfigure,
  noteWidgetTypesInMarkdown,
} from './noteLayout'
import { widgetDisplayLabel } from '../../widgetLibraryModel'
import { WidgetInstanceSettings } from '../../widgets/shared/WidgetInstanceSettings'
import { NoteWidgetPicker } from './NoteWidgetPicker'
import { decorateNoteReadSurface } from './noteReadSurface'
import { preloadNoteWidgets, useNoteWidgetCatalog } from './noteWidgetCatalog'
import { noteWidgetTypesInHtml } from './noteWidgetHtml'
import {
  replaceNoteHtml,
  useNoteWidgetHydration,
} from './noteWidgetMount'
import { getArticleProseClass } from '../reader/articleProseClass'
import { useReaderSettings } from '../reader/hooks/useReaderSettings'
import { openNoteCloudDoc } from './useNoteCloud'
import {
  cloudFieldsOf,
  mergeCloudFields,

  useNoteCloudSave,
} from './useNoteCloudSave'
import { useNoteSelection } from './useNoteSelection'
import '../ui/brew.css'
import './NoteEditor.css'

// 富文本层里的图片：Markdown 存原地址，浏览器看本站 origin 上的那份。
setVisualImageResolver(displayImageUrl)

/** 点击坐标 → 文本节点位置。Chrome / Firefox 是 caretPositionFromPoint，WebKit 是 caretRangeFromPoint。 */
function caretFromPoint(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const modern = (doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }).caretPositionFromPoint
  if (modern) {
    const position = modern.call(doc, x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : null
  }
  const legacy = (doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }).caretRangeFromPoint
  const range = legacy?.call(doc, x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

/**
 * 纸面滚动必须瞬间。html 继承了 scroll-behavior:smooth，直接改 scrollTop
 * 也会滑进卡槽；先钉成 auto 再赋。
 */
function setScrollTop(container: HTMLElement, top: number): void {
  const prev = container.style.scrollBehavior
  container.style.scrollBehavior = 'auto'
  container.scrollTop = top
  container.style.scrollBehavior = prev
}

/** 目标已经在视口里就不动；出了视口才瞬间挪到刚好露出来的最近一边。 */
function revealInContainer(container: HTMLElement, rect: DOMRect, margin = 48): void {
  const box = container.getBoundingClientRect()
  let delta = 0
  if (rect.top < box.top + margin) delta = rect.top - (box.top + margin)
  else if (rect.bottom > box.bottom - margin) delta = rect.bottom - (box.bottom - margin)
  if (Math.abs(delta) < 1) return
  setScrollTop(container, container.scrollTop + delta)
}

const DRAFT_SAVE_MS = 800
const VISUAL_UNDO_GROUP_MS = 600
const VISUAL_UNDO_LIMIT = 200
const URL_LIKE = /^https?:\/\/\S+$/i

interface NoteEditorProps {
  noteId?: number
  docId?: number
  onClose: () => void
  onSaved: (id: number) => void
  onDeleted?: (id: number) => void
}

type Pane = NoteEditorPane

interface NoteSnapshot {
  title: string
  contentMd: string
  topic: string | null
  cover: string | null
  publishedAt: number | null
}

const EMPTY_SNAPSHOT: NoteSnapshot = {
  title: '',
  contentMd: '',
  topic: null,
  cover: null,
  publishedAt: null,
}

export default function NoteEditor({
  noteId,
  docId,
  onClose,
  onSaved,
  onDeleted,
}: NoteEditorProps) {
  const { t, format } = useI18n()
  const { user } = useAuth()
  const {
    isDark,
    currentTheme,
    currentFont,
    fontSize,
    lineHeight,
  } = useReaderSettings()
  const previewSurfaceClass = useMemo(
    () => `brew-note__article ${getArticleProseClass(isDark, currentTheme.text)}`,
    [currentTheme.text, isDark],
  )
  const readerSurfaceStyle = useMemo(
    () => ({
      fontSize: `${fontSize}px`,
      lineHeight,
      fontFamily: currentFont.family,
    }),
    [currentFont.family, fontSize, lineHeight],
  )
  const animation = useBrewAnimationConfig()
  const motionEnabled = !isExlight(animation)
  const [cloudId, setCloudId] = useState<number | null>(docId ?? null)
  /** 本地草稿的键：已发布用 item id，云端稿用 doc id，还没建云端稿的新稿才是 'new'。 */
  const draftKey: number | 'new' = noteId ?? cloudId ?? 'new'
  const [categoryNames, setCategoryNames] = useState<string[]>([])

  const [title, setTitle] = useState('')
  const [contentMd, setContentMd] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [publishedAt, setPublishedAt] = useState<number | null>(null)
  const [saved, setSaved] = useState<NoteSnapshot>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const htmlRef = useRef('')
  /** 这份消毒 HTML 对应的原文。正文改过就丢掉，避免预览先闪旧稿。 */
  const previewMdRef = useRef('')
  const [previewing, setPreviewing] = useState(false)
  /** 写 / 可视是两种输入法；预览是顶栏开关，关掉回到上一种。 */
  const [pane, setPane] = useState<Pane>('write')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [insertMenu, setInsertMenu] = useState<NoteInsertMenuState>(null)
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkInitial, setLinkInitial] = useState('')
  const [blockFocus, setBlockFocus] = useState(false)
  const [codeLang, setCodeLang] = useState('')
  const [columnAlign, setColumnAlign] = useState<TableAlign>(null)
  const [selectedImage, setSelectedImage] = useState<{
    anchor: SelectionAnchor
    alt: string
  } | null>(null)
  const [selectedWidget, setSelectedWidget] = useState<{
    anchor: SelectionAnchor
    type: string
    size: string
  } | null>(null)
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false)
  const [docStatus, setDocStatus] = useState<'draft' | 'scheduled' | 'published'>('draft')
  const [scheduledAt, setScheduledAt] = useState<number | null>(null)
  const [peers, setPeers] = useState<NoteCollabPeer[]>([])
  const [cloudHint, setCloudHint] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const visualRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const overlayOpenRef = useRef(false)
  const savedRangeRef = useRef<Range | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  /** 预览之前用的是哪种输入法；点预览编辑就回到它。 */
  const lastEditPaneRef = useRef<'write' | 'visual'>('write')
  const pendingJumpRef = useRef<{
    pane: 'write' | 'visual'
    index: number
    plainOffset: number
  } | null>(null)
  const activeBlockRef = useRef<HTMLElement | null>(null)
  const selectionRef = useRef<SelectionAnchor | null>(null)
  const selectedImageRef = useRef<HTMLImageElement | null>(null)
  const selectedWidgetRef = useRef<HTMLElement | null>(null)
  const widgetSettingsOpenRef = useRef(false)
  const blockBarRef = useRef<HTMLDivElement | null>(null)
  const widgetCatalog = useNoteWidgetCatalog(true)
  const imageReplaceRef = useRef<HTMLInputElement>(null)
  /** 写栏里 ⌘K 落在已有链接上，记住它，回车时是改地址不是再包一层。 */
  const editingLinkRef = useRef<InlineLink | null>(null)
  /** 可视层自己的撤销栈：绕过 execCommand 的 DOM 操作也能撤。 */
  const historyRef = useRef<{
    past: string[]
    future: string[]
    lastPush: number
    recorded: string
    restoring: boolean
  }>({ past: [], future: [], lastPush: 0, recorded: '', restoring: false })
  const fileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)
  const visualEditing = useRef(false)
  /** 服务端 revision 只走 ref：变了不该触发任何 effect。 */
  const revisionRef = useRef(1)
  const titleRef = useRef('')
  const contentMdRef = useRef('')
  const topicRef = useRef<string | null>(null)
  const coverRef = useRef<string | null>(null)
  const publishedAtRef = useRef<number | null>(null)
  const paneRef = useRef<Pane>('write')
  const wsRef = useRef<WebSocket | null>(null)
  const coverPreview = useMemo(
    () => cover || firstMarkdownImage(contentMd),
    [cover, contentMd],
  )
  const selectedWidgetEntry = useMemo(
    () => widgetCatalog.find((entry) => entry.id === selectedWidget?.type),
    [widgetCatalog, selectedWidget?.type],
  )
  const selectedWidgetSizes = useMemo(() => {
    const allowed = new Set<string>(NOTE_WIDGET_SIZES)
    const supported = selectedWidgetEntry?.supportedSizes?.filter((size) =>
      allowed.has(size),
    )
    return supported && supported.length > 0 ? supported : [...NOTE_WIDGET_SIZES]
  }, [selectedWidgetEntry])
  const selectedWidgetSettings = selectedWidgetEntry?.settings ?? []
  const canConfigureWidget = noteWidgetCanConfigure(selectedWidgetEntry)
  const bodyChars = useMemo(() => countNoteChars(contentMd), [contentMd])
  htmlRef.current = html
  titleRef.current = title
  contentMdRef.current = contentMd
  topicRef.current = topic
  coverRef.current = cover
  publishedAtRef.current = publishedAt
  paneRef.current = pane

  /** 服务端回的文档：只更新状态类字段，内容由云存 hook 管。 */
  const applyServerDoc = useCallback((doc: BrewNoteDoc) => {
    revisionRef.current = doc.revision
    setDocStatus(doc.status)
    setScheduledAt(doc.scheduled_at)
    setLastError(doc.last_error ?? null)
  }, [])

  const applyMergedFields = useCallback((fields: NoteCloudFields) => {
    // 远端合进来的是原文；可视层若还标着自己在改，会跳过灌 DOM。
    visualEditing.current = false
    setTitle(fields.title)
    setContentMd(expandJammedDefinitions(fields.contentMd))
    setTopic(fields.topic)
    setCover(fields.cover)
    setPublishedAt(fields.publishedAt)
  }, [])

  const cloud = useNoteCloudSave({
    cloudId,
    loading,
    fields: { title, contentMd, topic, cover, publishedAt },
    revisionRef,
    onServerDoc: applyServerDoc,
    onMerged: applyMergedFields,
    // 云端存上了就是「已保存」：关门不再问要不要丢弃。
    onSaved: (acked) => {
      setCloudHint(true)
      setSaved(acked)
    },
    onError: (message) =>
      showNoteNotice(
        message,
        message === t.brew.noteRevisionConflict ? 'warning' : 'error',
      ),
    labels: {
      saveFailed: t.brew.errorSaveFailed,
      conflict: t.brew.noteRevisionConflict,
    },
  })
  const baseRef = cloud.baseRef
  widgetSettingsOpenRef.current = widgetSettingsOpen
  overlayOpenRef.current =
    settingsOpen ||
    insertMenu != null ||
    linkOpen ||
    widgetPickerOpen ||
    widgetSettingsOpen

  const {
    selection: selectionAnchor,
    marks: activeMarks,
    caretLine,
    block,
  } = useNoteSelection(
    pane,
    scrollRef,
    textareaRef,
    visualRef,
    !loading,
    insertMenu != null ||
      linkOpen ||
      blockFocus ||
      widgetPickerOpen ||
      widgetSettingsOpen,
  )
  selectionRef.current = selectionAnchor

  const focusBody = useCallback(() => {
    if (paneRef.current === 'visual') visualRef.current?.focus()
    else textareaRef.current?.focus()
  }, [])

  // 可视层的撤销栈：每次正文变化记一笔，连续敲字 600ms 内合成一笔。
  useEffect(() => {
    // 挪到下面 syncVisualFromMarkdown 之后再挂 undo/redo；这里只记账。
    const history = historyRef.current
    if (pane !== 'visual' || loading) {
      history.recorded = contentMd
      return
    }
    if (history.restoring) {
      history.restoring = false
      history.recorded = contentMd
      return
    }
    if (contentMd === history.recorded) return
    const now = Date.now()
    if (now - history.lastPush > VISUAL_UNDO_GROUP_MS || history.past.length === 0) {
      history.past.push(history.recorded)
      if (history.past.length > VISUAL_UNDO_LIMIT) history.past.shift()
      history.future = []
    }
    history.lastPush = now
    history.recorded = contentMd
  }, [contentMd, pane, loading])

  /** 空行上敲 `/`：不落字，直接开插入菜单。 */
  const slashTrigger = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, onEmptyLine: () => boolean) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (!onEmptyLine()) return
      event.preventDefault()
      setInsertMenu('keys')
    },
    [],
  )

  // 标题和写栏都随内容长高，滚动交给整页。能 field-sizing 就让浏览器自己长。
  useLayoutEffect(() => {
    if (loading || textareaSupportsFieldSizing()) return
    growTextarea(titleInputRef.current)
    if (pane === 'write') growTextarea(textareaRef.current)
  }, [title, contentMd, pane, loading])

  useEffect(() => {
    const controller = new AbortController()
    const run = async () => {
      try {
        const doc = await openNoteCloudDoc({
          noteId,
          docId,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const server: NoteSnapshot = {
          title: doc.title,
          contentMd: doc.content_md,
          topic: normalizeNoteTopic(doc.topic),
          cover: normalizeNoteCover(doc.image),
          publishedAt: doc.published_at ?? Date.now(),
        }
        // 新稿在 'new' 下写过的本地草稿，建好云端稿之后要跟着搬到 doc id 下面。
        const draft = readNoteDraft(noteId ?? docId ?? 'new') ?? readNoteDraft(noteId ?? doc.id)
        if (noteId === undefined && docId === undefined) clearNoteDraft('new')
        const useDraft = draftDiffersFrom(draft, server)
        const next: NoteSnapshot = {
          title: useDraft && draft ? draft.title : server.title,
          contentMd: expandJammedDefinitions(
            useDraft && draft ? draft.contentMd : server.contentMd,
          ),
          topic:
            useDraft && draft && draft.topic !== undefined
              ? draft.topic
              : server.topic,
          cover:
            useDraft && draft && draft.cover !== undefined
              ? draft.cover
              : server.cover,
          publishedAt:
            useDraft && draft && draft.publishedAt != null
              ? draft.publishedAt
              : server.publishedAt,
        }
        // 服务端那份是「已确认」和合并基准；本地草稿比它新就会在下一拍推上去。
        cloud.ack(server)
        applyServerDoc(doc)
        setCloudId(doc.id)
        applyMergedFields(next)
        setSaved(next)
        if (doc.last_error) {
          showNoteNotice(userFacingError(doc.last_error, t.brew.noteScheduleFailed))
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          showNoteNotice(userFacingError(err, t.brew.errorLoadFailed))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void run()
    return () => {
      controller.abort()
    }
    // 只跟打开的是哪一篇走。语言包变了不要再建一篇空草稿。
  }, [noteId, docId])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      brewApi.getCategories(undefined, { signal: controller.signal }).catch(() => []),
      brewApi.listNoteDocs(controller.signal).catch(() => []),
      brewApi
        .getItemPreviews(
          { category: BREW_MINE_CATEGORY, per_page: 40, sort_order: 'desc' },
          undefined,
          { signal: controller.signal },
        )
        .catch(() => ({ items: [] as Array<{ guid: string; topic?: string | null }> })),
    ]).then(([cats, docs, preview]) => {
      if (controller.signal.aborted) return
      setCategoryNames(
        collectNoteCategories([
          ...cats.map((cat) => ({ topic: cat.name })),
          ...docs,
          ...preview.items.filter((item) => item.guid.startsWith('note:')),
        ]),
      )
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (loading) return
    const timer = setTimeout(writeNoteDraft, DRAFT_SAVE_MS, draftKey, {
      title,
      contentMd,
      topic,
      cover,
      publishedAt,
    })
    return () => clearTimeout(timer)
  }, [draftKey, title, contentMd, topic, cover, publishedAt, loading])

  // 预览只在预览栏打。原文对得上就复用，不对就丢掉旧稿再 POST。
  useEffect(() => {
    if (loading || pane !== 'preview') return
    if (!contentMd.trim()) {
      previewMdRef.current = ''
      setHtml('')
      setPreviewing(false)
      return
    }
    const source = expandJammedDefinitions(contentMd)
    if (source !== contentMd) {
      setContentMd(source)
      return
    }
    if (previewMdRef.current === source && htmlRef.current) return
    const controller = new AbortController()
    setPreviewing(true)
    void (async () => {
      try {
        const rendered = await brewApi.previewNote(source, controller.signal)
        if (!controller.signal.aborted && contentMdRef.current === source) {
          previewMdRef.current = source
          setHtml(rendered)
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          showNoteNotice(userFacingError(err, t.brew.notePreviewFailed))
        }
      } finally {
        if (!controller.signal.aborted) setPreviewing(false)
      }
    })()
    return () => {
      controller.abort()
    }
  }, [contentMd, loading, pane, t.brew.notePreviewFailed])

  useLayoutEffect(() => {
    if (!html || previewMdRef.current === contentMd) return
    previewMdRef.current = ''
    setHtml('')
  }, [contentMd, html])

  useLayoutEffect(() => {
    if (pane !== 'visual') return
    const el = visualRef.current
    if (!el) return
    // 水合后 face 会改 innerHTML。用原文指纹，打字 / 失焦 / 写栏往返都不整树重挂。
    if (visualEditing.current) {
      el.dataset.noteVisual = contentMd
      return
    }
    if (el.dataset.noteVisual === contentMd) return
    replaceNoteHtml(el, markdownToVisualHtml(contentMd))
    el.dataset.noteVisual = contentMd
  }, [pane, contentMd])

  useLayoutEffect(() => {
    if (pane !== 'preview') return
    const el = previewRef.current
    if (!el) return
    const stale = Boolean(html) && previewMdRef.current !== contentMd
    if (stale) {
      previewMdRef.current = ''
      setHtml('')
    }
    const source = html && !stale ? prepareNoteReaderHtml(html, '') : ''
    const stamp = stale ? '' : html
    if (el.dataset.noteRead === stamp) return
    replaceNoteHtml(el, source)
    if (source) decorateNoteReadSurface(el, t.brew.copyCode)
    el.dataset.noteRead = stamp
  }, [pane, html, contentMd, t.brew.copyCode])

  if (pane === 'preview') preloadNoteWidgets(noteWidgetTypesInHtml(html))
  else preloadNoteWidgets(noteWidgetTypesInMarkdown(contentMd))

  const persistVisualWidgetConfig = useCallback(
    (host: HTMLElement, config: Parameters<typeof setNoteWidgetConfig>[2]) => {
      const root = visualRef.current
      if (!root) return
      visualEditing.current = true
      setContentMd(setNoteWidgetConfig(root, host, config))
    },
    [],
  )
  const visualWidgets = useNoteWidgetHydration(
    visualRef,
    widgetCatalog,
    pane,
    pane !== 'preview',
    {
      editable: true,
      onConfigChange: persistVisualWidgetConfig,
    },
  )
  const previewWidgets = useNoteWidgetHydration(
    previewRef,
    widgetCatalog,
    pane,
    pane === 'preview',
  )

  if (pane !== 'preview') lastEditPaneRef.current = pane

  /**
   * 点预览即编辑：预览里点到哪一块的哪个字，就切回上一种输入法，把光标放到
   * Markdown 里对应的位置。块级靠后端打的原文区间，字级靠纯文本对齐。
   */
  const jumpFromPreview = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const root = previewRef.current
      const target = event.target as HTMLElement
      if (!root || !root.contains(target)) return
      // 水合后面的字不在原文里。点小组件只回到这一块的 :::widget，不对齐 face。
      const widget = target.closest<HTMLElement>('.note-widget')
      const block = widget?.hasAttribute('data-md-start')
        ? widget
        : target.closest<HTMLElement>('[data-md-start]')
      if (!block || !root.contains(block)) return
      const range = blockSourceRange(contentMdRef.current, {
        start: block.dataset.mdStart,
        end: block.dataset.mdEnd,
      })
      if (!range) return
      event.preventDefault()
      const caret = caretFromPoint(document, event.clientX, event.clientY)
      let plainPrefix = ''
      if (!widget && caret && block.contains(caret.node)) {
        const measure = document.createRange()
        measure.setStart(block, 0)
        measure.setEnd(caret.node, caret.offset)
        plainPrefix = measure.toString()
      }
      const index = previewClickToMarkdownIndex(contentMdRef.current, range, plainPrefix)
      pendingJumpRef.current = {
        pane: lastEditPaneRef.current,
        index,
        plainOffset: plainPrefix.length,
      }
      setPane(lastEditPaneRef.current)
    },
    [],
  )

  // 换栏后只放光标，不改滚动。默认看得见的那一截也可以溢出去。
  useLayoutEffect(() => {
    const jump = pendingJumpRef.current
    if (!jump || jump.pane !== pane) return
    pendingJumpRef.current = null
    if (jump.pane === 'write') {
      const el = textareaRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(jump.index, jump.index)
      return
    }
    const root = visualRef.current
    if (!root) return
    const block = root.children[blockIndexAt(contentMdRef.current, jump.index)] as
      | HTMLElement
      | undefined
    root.focus({ preventScroll: true })
    if (block) placeCaretAtTextOffset(root, block, jump.plainOffset)
  }, [pane])

  useEffect(() => {
    if (cloudId == null) return
    const ws = new WebSocket(brewApi.noteDocWsUrl(cloudId))
    wsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const incoming = JSON.parse(String(event.data)) as NoteCollabEvent
        setPeers((current) => applyCollabPeers(current, incoming))
        const persist = shouldApplyRemoteDoc(incoming, revisionRef.current)
        const live = shouldApplyRemoteEdit(incoming)
        if ((persist || live) && incoming.content_md != null) {
          const local: NoteCloudFields = {
            title: titleRef.current,
            contentMd: contentMdRef.current,
            topic: topicRef.current,
            cover: coverRef.current,
            publishedAt: publishedAtRef.current,
          }
          const remote: NoteCloudFields = {
            title: incoming.title ?? local.title,
            contentMd: incoming.content_md,
            topic: incoming.topic ?? local.topic,
            cover: incoming.image ?? local.cover,
            publishedAt: local.publishedAt,
          }
          const merged = mergeCloudFields(baseRef.current, local, remote)
          if (persist && incoming.revision != null) {
            // 别人存下来的整篇：服务端就是这份，记为已确认；我们没推上去的改动合进去后会再存。
            revisionRef.current = incoming.revision
            cloud.ack(remote)
          }
          applyMergedFields(merged)
        }
      } catch {
        /* 坏帧丢掉 */
      }
    }
    const ping = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'presence',
          name: user?.username,
          cursor: textareaRef.current?.selectionStart ?? 0,
        }),
      )
    }, 4000)
    return () => {
      window.clearInterval(ping)
      wsRef.current = null
      ws.close()
      // 房间换了 / 断了，上一间的人不该还画在这里。
      setPeers([])
    }
  }, [cloudId, user?.username])

  // 切面板、进预览：浮着的东西全收——图片选中框、插入菜单、地址栏。
  useEffect(() => {
    selectedImageRef.current?.classList.remove('is-selected')
    selectedImageRef.current = null
    setSelectedImage(null)
    setInsertMenu(null)
    setLinkOpen(false)
  }, [pane])

  useEffect(() => {
    if (loading || cloudId == null) return
    const timer = window.setTimeout(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'edit',
          name: user?.username,
          cursor: textareaRef.current?.selectionStart ?? 0,
          title,
          content_md: contentMd,
          topic,
          image: cover,
        }),
      )
    }, 200)
    return () => window.clearTimeout(timer)
  }, [cloudId, title, contentMd, topic, cover, loading, user?.username])

  const dirty = useMemo(
    () =>
      title.trim() !== saved.title.trim() ||
      contentMd.trim() !== saved.contentMd.trim() ||
      normalizeNoteTopic(topic) !== normalizeNoteTopic(saved.topic) ||
      normalizeNoteCover(cover) !== normalizeNoteCover(saved.cover) ||
      !sameNoteMinute(publishedAt, saved.publishedAt),
    [title, contentMd, topic, cover, publishedAt, saved],
  )

  const applyEdit = useCallback(
    (
      fn: (
        value: string,
        start: number,
        end: number,
      ) => { value: string; selectionStart: number; selectionEnd: number },
    ) => {
      const el = textareaRef.current
      if (!el) return
      const result = fn(el.value, el.selectionStart, el.selectionEnd)
      setContentMd(result.value)
      // setState 后等下一帧再设选区。
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(result.selectionStart, result.selectionEnd)
      })
    },
    [],
  )

  /** 行内记号是切换：已经包着就拆掉。 */
  const wrap = useCallback(
    (before: string, after: string, placeholder: string) =>
      applyEdit((v, s, e) => toggleWrap(v, s, e, before, after, placeholder)),
    [applyEdit],
  )

  /** 只插，不切换（图片、脚注这种）。 */
  const insertText = useCallback(
    (before: string, after: string, placeholder: string) =>
      applyEdit((v, s, e) => wrapSelection(v, s, e, before, after, placeholder)),
    [applyEdit],
  )

  const prefix = useCallback(
    (mark: string) => applyEdit((v, s, e) => prefixLines(v, s, e, mark)),
    [applyEdit],
  )

  const syncVisualFromMarkdown = useCallback((next: string) => {
    setContentMd(next)
    const el = visualRef.current
    if (paneRef.current === 'visual' && el) {
      replaceNoteHtml(el, markdownToVisualHtml(next))
      el.dataset.noteVisual = next
    }
  }, [])

  /** 可视 DOM 已经改过：只回写原文，不 replaceNoteHtml。 */
  const commitVisualMd = useCallback((next: string) => {
    visualEditing.current = true
    setContentMd(next)
  }, [])

  const runVisual = useCallback((command: string, value?: string) => {
    const root = visualRef.current
    if (!root) return
    commitVisualMd(runVisualCommand(root, command, value))
  }, [commitVisualMd])

  const runTool = useCallback(
    (markdown: () => void, visual?: { command: string; value?: string }) => {
      if (pane === 'visual' && visual) {
        runVisual(visual.command, visual.value)
        return
      }
      markdown()
    },
    [pane, runVisual],
  )

  /** 可视层 ⌘Z / ⌘⇧Z：整段回放 Markdown，光标落到末尾。 */
  const visualHistoryStep = useCallback(
    (direction: 'undo' | 'redo') => {
      const history = historyRef.current
      const from = direction === 'undo' ? history.past : history.future
      const to = direction === 'undo' ? history.future : history.past
      const next = from.pop()
      if (next === undefined) return
      to.push(contentMdRef.current)
      history.restoring = true
      history.lastPush = 0
      syncVisualFromMarkdown(next)
      const root = visualRef.current
      if (root) {
        root.focus()
        const range = document.createRange()
        range.selectNodeContents(root)
        range.collapse(false)
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    },
    [syncVisualFromMarkdown],
  )

  const fieldMessage = useCallback(
    (kind: ReturnType<typeof noteFieldError>) => {
      if (kind === 'empty-title') return t.brew.noteTitleRequired
      if (kind === 'title-too-long') {
        return format(t.brew.noteTitleTooLong, {
          max: MAX_NOTE_TITLE_CHARS,
          chars: countNoteChars(title.trim()),
        })
      }
      if (kind === 'body-too-long') {
        return format(t.brew.noteBodyTooLong, {
          max: MAX_NOTE_BODY_CHARS,
          chars: countNoteChars(contentMd),
        })
      }
      return null
    },
    [contentMd, format, t.brew.noteBodyTooLong, t.brew.noteTitleRequired, t.brew.noteTitleTooLong, title],
  )

  /** 往正文插一张图：可视层插 `<img>`，写栏插 Markdown。 */
  const placeImage = useCallback(
    (src: string, alt: string) => {
      const root = visualRef.current
      if (paneRef.current === 'visual' && root) {
        commitVisualMd(insertImage(root, src, alt))
        return
      }
      insertText(`![${alt}](${src})`, '', '')
    },
    [insertText, commitVisualMd],
  )

  const handleUpload = useCallback(
    async (file: File, as: 'body' | 'cover' | 'replace') => {
      setUploading(true)
      try {
        const uploaded = await federationApi.uploadMedia(file, {
          filename: file.name,
        })
        if (as === 'cover') {
          setCover(uploaded.url)
        } else if (as === 'replace') {
          const root = visualRef.current
          const img = selectedImageRef.current
          if (root && img) commitVisualMd(setImageSrc(root, img, uploaded.url))
        } else {
          placeImage(uploaded.url, file.name)
        }
      } catch (err) {
        showNoteNotice(userFacingError(err, t.brew.errorSaveFailed))
      } finally {
        setUploading(false)
      }
    },
    [placeImage, t.brew.errorSaveFailed, commitVisualMd],
  )

  const handleSave = useCallback(async () => {
    if (saving) return
    const invalid = noteFieldError(title, contentMd)
    if (invalid) {
      showNoteNotice(fieldMessage(invalid))
      return
    }
    setSaving(true)
    // 正文里已经没人引用的脚注定义，发布时清掉；写作过程中不动。
    const body = pruneOrphanFootnotes(expandJammedDefinitions(contentMd))
    if (body !== contentMd) setContentMd(body)
    const payload = toNoteWritePayload(title, body, topic, cover, publishedAt)
    try {
      if (cloudId != null) {
        const result = await brewApi.publishNoteDoc(cloudId, {
          title: payload.title,
          content_md: payload.content_md,
          topic: payload.topic,
          image: payload.image ?? null,
          published_at: payload.published_at,
        })
        clearNoteDraft(draftKey)
        clearNoteDraft('new')
        onSaved(result.id)
        return
      }
      const result =
        noteId === undefined
          ? await brewApi.createNote(payload)
          : await brewApi.updateNote(noteId, payload)
      clearNoteDraft(draftKey)
      if (noteId === undefined) clearNoteDraft('new')
      onSaved(result.id)
    } catch (err) {
      showNoteNotice(userFacingError(err, t.brew.errorSaveFailed))
    } finally {
      setSaving(false)
    }
  }, [
    saving,
    title,
    contentMd,
    topic,
    cover,
    publishedAt,
    noteId,
    cloudId,
    draftKey,
    onSaved,
    fieldMessage,
    t.brew.errorSaveFailed,
  ])

  useEffect(() => {
    if (!cloudHint) return
    const timer = window.setTimeout(setCloudHint, 1600, false)
    return () => window.clearTimeout(timer)
  }, [cloudHint])

  const handleSchedule = useCallback(async () => {
    if (cloudId == null || saving) return
    const invalid = noteFieldError(title, contentMd)
    if (invalid) {
      showNoteNotice(fieldMessage(invalid))
      return
    }
    const timeError = noteScheduleError(scheduledAt)
    if (timeError === 'missing-time') {
      showNoteNotice(t.brew.noteScheduleNeedTime)
      return
    }
    if (timeError === 'already-due') {
      showNoteNotice(t.brew.noteSchedulePast)
      return
    }
    const when = scheduledAt
    if (when == null) return
    setSaving(true)
    try {
      const doc = await brewApi.scheduleNoteDoc(cloudId, {
        title,
        content_md: contentMd,
        topic,
        image: cover,
        scheduled_at: when,
      })
      // 服务端把发布时间对齐到了定时点；本地跟上，免得下一拍又把旧时间推回去。
      applyServerDoc(doc)
      cloud.ack(cloudFieldsOf(doc))
      setPublishedAt(doc.published_at)
    } catch (err) {
      showNoteNotice(userFacingError(err, t.brew.errorSaveFailed))
    } finally {
      setSaving(false)
    }
  }, [
    cloudId,
    saving,
    scheduledAt,
    title,
    contentMd,
    topic,
    cover,
    fieldMessage,
    t.brew.errorSaveFailed,
    t.brew.noteScheduleNeedTime,
    t.brew.noteSchedulePast,
  ])

  const handleUnschedule = useCallback(async () => {
    if (cloudId == null || saving) return
    setSaving(true)
    try {
      const doc = await brewApi.unscheduleNoteDoc(cloudId)
      applyServerDoc(doc)
    } catch (err) {
      showNoteNotice(userFacingError(err, t.brew.errorSaveFailed))
    } finally {
      setSaving(false)
    }
  }, [cloudId, saving, t.brew.errorSaveFailed])

  const handleDelete = useCallback(async () => {
    if (saving) return
    if (!window.confirm(t.brew.noteDeleteConfirm)) return
    setSaving(true)
    try {
      if (noteId !== undefined) {
        await brewApi.deleteNote(noteId)
        clearNoteDraft(noteId)
        onDeleted?.(noteId)
        return
      }
      if (cloudId != null && docStatus !== 'published') {
        await brewApi.deleteNoteDoc(cloudId)
        clearNoteDraft('new')
        onClose()
      }
    } catch (err) {
      showNoteNotice(userFacingError(err, t.brew.errorDeleteFailed))
      setSaving(false)
    }
  }, [
    noteId,
    cloudId,
    docStatus,
    saving,
    onDeleted,
    onClose,
    t.brew.noteDeleteConfirm,
    t.brew.errorDeleteFailed,
  ])

  // Esc 关闭；有云端没存上的改动时先确认。确认丢弃就连本地草稿一起丢，别下次开门又冒出来。
  const requestClose = useCallback(() => {
    if (dirty) {
      if (!window.confirm(t.brew.noteDiscardConfirm)) return
      clearNoteDraft(draftKey)
      clearNoteDraft('new')
    }
    if (
      cloudId != null &&
      noteId === undefined &&
      docStatus === 'draft' &&
      !title.trim() &&
      !contentMd.trim()
    ) {
      void brewApi.deleteNoteDoc(cloudId)
      clearNoteDraft(draftKey)
      clearNoteDraft('new')
    }
    onClose()
  }, [
    dirty,
    onClose,
    t.brew.noteDiscardConfirm,
    cloudId,
    noteId,
    docStatus,
    title,
    contentMd,
    draftKey,
  ])

  // ---- 格式动作：写栏改 Markdown，可视层改 DOM。快捷键、浮动条、菜单都走这几只 ----

  const heading = useCallback(
    (level: number) => {
      const root = visualRef.current
      if (paneRef.current === 'visual' && root) {
        commitVisualMd(toggleVisualHeading(root, level))
        return
      }
      applyEdit((v, s, e) => setHeadingLevel(v, s, e, level))
    },
    [applyEdit, commitVisualMd],
  )

  const inlineCode = useCallback(() => {
    const root = visualRef.current
    if (paneRef.current === 'visual' && root) {
      commitVisualMd(toggleVisualInlineCode(root))
      return
    }
    wrap('`', '`', t.brew.noteToolInlineCode)
  }, [wrap, t.brew.noteToolInlineCode, commitVisualMd])

  const bold = useCallback(
    () => runTool(() => wrap('**', '**', t.brew.noteToolBold), { command: 'bold' }),
    [runTool, wrap, t.brew.noteToolBold],
  )
  const italic = useCallback(
    () => runTool(() => wrap('*', '*', t.brew.noteToolItalic), { command: 'italic' }),
    [runTool, wrap, t.brew.noteToolItalic],
  )
  const strike = useCallback(
    () =>
      runTool(() => wrap('~~', '~~', t.brew.noteToolStrike), {
        command: 'strikeThrough',
      }),
    [runTool, wrap, t.brew.noteToolStrike],
  )
  const bulletList = useCallback(
    () => runTool(() => prefix('- '), { command: 'insertUnorderedList' }),
    [runTool, prefix],
  )
  const orderedList = useCallback(
    () => runTool(() => prefix('1. '), { command: 'insertOrderedList' }),
    [runTool, prefix],
  )
  const taskList = useCallback(
    () =>
      runTool(() => prefix('- [ ] '), {
        command: 'insertHTML',
        value: '<ul data-task="1"><li data-task="0"><br></li></ul>',
      }),
    [runTool, prefix],
  )

  /** 链接地址栏。可视层先记住选区，输入框抢焦点后还能放回去。 */
  const openLink = useCallback(() => {
    const root = visualRef.current
    editingLinkRef.current = null
    if (paneRef.current === 'visual' && root) {
      const selection = document.getSelection()
      savedRangeRef.current =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).cloneRange()
          : null
      setLinkInitial(visualClosest(root, 'a')?.getAttribute('href') ?? '')
    } else {
      const el = textareaRef.current
      const existing = el ? linkAtCursor(el.value, el.selectionStart) : null
      editingLinkRef.current = existing
      setLinkInitial(existing?.url ?? '')
    }
    setLinkOpen(true)
  }, [])

  const rememberVisualRange = useCallback(() => {
    const selection = document.getSelection()
    savedRangeRef.current =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).cloneRange()
        : null
  }, [])

  const restoreVisualRange = useCallback(() => {
    const selection = document.getSelection()
    const range = savedRangeRef.current
    if (selection && range) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }, [])

  const applyLink = useCallback(
    (url: string | null) => {
      setLinkOpen(false)
      if (paneRef.current === 'visual') {
        restoreVisualRange()
        if (url) runVisual('createLink', url)
        else runVisual('unlink')
        return
      }
      const editing = editingLinkRef.current
      if (editing) {
        editingLinkRef.current = null
        applyEdit((v) => replaceLink(v, editing, url))
        return
      }
      if (url) insertText('[', `](${url})`, t.brew.noteToolLink)
      else textareaRef.current?.focus()
    },
    [restoreVisualRange, runVisual, applyEdit, insertText, t.brew.noteToolLink],
  )

  /** 选中了字再粘一个网址：直接变链接，不是替换文字。 */
  const pasteAsLink = useCallback(
    (text: string): boolean => {
      const url = text.trim()
      if (!URL_LIKE.test(url)) return false
      const root = visualRef.current
      if (paneRef.current === 'visual' && root) {
        const selection = document.getSelection()
        if (!selection || selection.isCollapsed) return false
        runVisual('createLink', url)
        return true
      }
      const el = textareaRef.current
      if (!el || el.selectionStart === el.selectionEnd) return false
      insertText('[', `](${url})`, '')
      return true
    },
    [runVisual, insertText],
  )

  /** 点中一张图：记住它，块工具条切到图片。 */
  const selectImage = useCallback((img: HTMLImageElement | null) => {
    selectedImageRef.current?.classList.remove('is-selected')
    img?.classList.add('is-selected')
    selectedImageRef.current = img
    const container = scrollRef.current
    if (!img || !container) {
      setSelectedImage(null)
      return
    }
    setSelectedImage({
      anchor: anchorInContainer(img.getBoundingClientRect(), container),
      alt: img.alt,
    })
  }, [])

  const selectWidget = useCallback((widget: HTMLElement | null) => {
    selectedWidgetRef.current?.classList.remove('is-selected')
    widget?.classList.add('is-selected')
    selectedWidgetRef.current = widget
    const container = scrollRef.current
    if (!widget || !container) {
      setSelectedWidget(null)
      setWidgetSettingsOpen(false)
      visualWidgets.refresh()
      return
    }
    setSelectedWidget({
      anchor: anchorInContainer(widget.getBoundingClientRect(), container),
      type: widget.dataset.widget ?? '',
      size: widget.dataset.size ?? '2x2',
    })
    visualWidgets.refresh()
  }, [visualWidgets.refresh])

  // 正文变了（撤销、远端合并、换图）：选中的图要么已经不在树上了，要么位置挪了。
  useEffect(() => {
    const img = selectedImageRef.current
    if (!img) return
    if (!img.isConnected) {
      selectImage(null)
      return
    }
    const container = scrollRef.current
    if (!container) return
    const anchor = anchorInContainer(img.getBoundingClientRect(), container)
    setSelectedImage((current) =>
      current &&
      current.anchor.top === anchor.top &&
      current.anchor.left === anchor.left &&
      current.anchor.width === anchor.width
        ? current
        : { anchor, alt: img.alt },
    )
  }, [contentMd, selectImage])

  const imageOp = useCallback(
    (fn: (root: HTMLElement, img: HTMLImageElement) => string, keep = true) => {
      const root = visualRef.current
      const img = selectedImageRef.current
      if (!root || !img) return
      commitVisualMd(fn(root, img))
      if (!keep) selectImage(null)
    },
    [selectImage, commitVisualMd],
  )

  const footnoteJump = useCallback((root: HTMLElement, target: HTMLElement) => {
    const ref = target.closest<HTMLElement>('sup[data-fnref]')
    if (!ref) return false
    const definition = root.querySelector<HTMLElement>(`p[data-fn="${ref.dataset.fnref}"]`)
    if (definition && scrollRef.current) {
      revealInContainer(scrollRef.current, definition.getBoundingClientRect())
    }
    return Boolean(definition)
  }, [])

  const closeOverlays = useCallback(() => {
    setSettingsOpen(false)
    setInsertMenu(null)
    setWidgetPickerOpen(false)
    setWidgetSettingsOpen(false)
    setLinkOpen(false)
    if (paneRef.current === 'visual') restoreVisualRange()
    focusBody()
  }, [restoreVisualRange, focusBody])

  // 光标进了表格 / 代码块，记住那个元素；语言输入框抢焦点时选区已经不在里面了。
  useEffect(() => {
    const root = visualRef.current
    if (!block || !root) {
      activeBlockRef.current = null
      setCodeLang('')
      return
    }
    const el =
      block.kind === 'columns'
        ? visualClosestClass(root, 'note-columns')
        : block.kind === 'widget'
          ? visualClosestClass(root, 'note-widget')
          : visualClosest(root, block.kind)
    activeBlockRef.current = el
    setCodeLang(el?.dataset.lang ?? '')
    setColumnAlign(el instanceof HTMLTableElement ? currentColumnAlign(root, el) : null)
  }, [block])

  const tableOp = useCallback(
    (fn: (root: HTMLElement, table: HTMLTableElement) => string) => {
      const root = visualRef.current
      const table = activeBlockRef.current
      if (!root || !(table instanceof HTMLTableElement)) return
      commitVisualMd(fn(root, table))
    },
    [commitVisualMd],
  )

  const columnsOp = useCallback(
    (fn: (root: HTMLElement, columns: HTMLElement) => string) => {
      const root = visualRef.current
      const columns = activeBlockRef.current
      if (!root || !columns?.classList.contains('note-columns')) return
      commitVisualMd(fn(root, columns))
    },
    [commitVisualMd],
  )

  const widgetOp = useCallback(
    (fn: (root: HTMLElement, widget: HTMLElement) => string, keep = true) => {
      const root = visualRef.current
      const widget = selectedWidgetRef.current ?? activeBlockRef.current
      if (!root || !widget?.classList.contains('note-widget')) return
      commitVisualMd(fn(root, widget))
      if (!keep) selectWidget(null)
      else visualWidgets.refresh()
    },
    [selectWidget, commitVisualMd, visualWidgets.refresh],
  )

  const changeCodeLang = useCallback((lang: string) => {
    setCodeLang(lang)
    const root = visualRef.current
    const pre = activeBlockRef.current
    if (root && pre instanceof HTMLPreElement) {
      commitVisualMd(setVisualCodeLang(root, pre, lang))
    }
  }, [commitVisualMd])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (overlayOpenRef.current) {
          closeOverlays()
          return
        }
        requestClose()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      // 可视层的撤销走自己的栈，把绕过 execCommand 的改动也管住。
      if (key === 'z' && !e.altKey && paneRef.current === 'visual') {
        e.preventDefault()
        visualHistoryStep(e.shiftKey ? 'redo' : 'undo')
        return
      }
      if (!e.shiftKey && !e.altKey) {
        if (key === 's') {
          e.preventDefault()
          void handleSave()
        } else if (key === 'b') {
          e.preventDefault()
          bold()
        } else if (key === 'i') {
          e.preventDefault()
          italic()
        } else if (key === 'e') {
          e.preventDefault()
          inlineCode()
        } else if (key === 'k') {
          e.preventDefault()
          if (selectionRef.current) openLink()
          else if (paneRef.current === 'visual') runVisual('createLink', 'https://')
          else wrap('[', '](https://)', t.brew.noteToolLink)
        }
        return
      }
      if (e.shiftKey && !e.altKey) {
        if (key === 'x') {
          e.preventDefault()
          strike()
        } else if (e.code === 'Digit7') {
          e.preventDefault()
          orderedList()
        } else if (e.code === 'Digit8') {
          e.preventDefault()
          bulletList()
        } else if (e.code === 'Digit9') {
          e.preventDefault()
          taskList()
        }
        return
      }
      if (e.altKey && !e.shiftKey) {
        const level = /^Digit([1-6])$/.exec(e.code)?.[1]
        if (level) {
          e.preventDefault()
          heading(Number(level))
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    requestClose,
    closeOverlays,
    handleSave,
    bold,
    italic,
    inlineCode,
    strike,
    orderedList,
    bulletList,
    taskList,
    heading,
    openLink,
    visualHistoryStep,
    wrap,
    runVisual,
    t.brew.noteToolLink,
  ])

  const tools = [
    {
      key: 'bold',
      icon: <Bold className="h-4 w-4" />,
      label: t.brew.noteToolBold,
      run: bold,
    },
    {
      key: 'italic',
      icon: <Italic className="h-4 w-4" />,
      label: t.brew.noteToolItalic,
      run: italic,
    },
    {
      key: 'strike',
      icon: <Strikethrough className="h-4 w-4" />,
      label: t.brew.noteToolStrike,
      run: strike,
    },
    {
      key: 'inline-code',
      icon: <Code className="h-4 w-4" />,
      label: t.brew.noteToolInlineCode,
      run: inlineCode,
    },
    {
      key: 'link',
      icon: <Link className="h-4 w-4" />,
      label: t.brew.noteToolLink,
      run: openLink,
    },
    {
      key: 'h2',
      icon: <span aria-hidden="true">H2</span>,
      label: t.brew.noteToolH2,
      run: () => heading(2),
    },
    {
      key: 'h3',
      icon: <span aria-hidden="true">H3</span>,
      label: t.brew.noteToolH3,
      run: () => heading(3),
    },
    {
      key: 'quote',
      icon: <Quote className="h-4 w-4" />,
      label: t.brew.noteToolQuote,
      run: () =>
        runTool(() => prefix('> '), { command: 'formatBlock', value: 'blockquote' }),
    },
    {
      key: 'code',
      icon: <SquareCode className="h-4 w-4" />,
      label: t.brew.noteToolCode,
      run: () =>
        runTool(() => wrap('\n```\n', '\n```\n', ''), {
          command: 'formatBlock',
          value: 'pre',
        }),
    },
    {
      key: 'list',
      icon: <List className="h-4 w-4" />,
      label: t.brew.noteToolList,
      run: bulletList,
    },
    {
      key: 'ol',
      icon: <ListOrdered className="h-4 w-4" />,
      label: t.brew.noteToolOl,
      run: orderedList,
    },
    {
      key: 'task',
      icon: <CheckSquare className="h-4 w-4" />,
      label: t.brew.noteToolTask,
      run: taskList,
    },
    {
      key: 'divider',
      icon: <Minus className="h-4 w-4" />,
      label: t.brew.noteToolDivider,
      run: () =>
        runTool(() => wrap('\n\n---\n\n', '', ''), {
          command: 'insertHorizontalRule',
        }),
    },
    {
      key: 'table',
      icon: <FileText className="h-4 w-4" />,
      label: t.brew.noteToolTable,
      run: () =>
        runTool(() => wrap('\n', `\n${insertTableMarkdown()}\n`, ''), {
          command: 'insertHTML',
          value: '<table><tr><th></th><th></th></tr><tr><td></td><td></td></tr></table>',
        }),
    },
    {
      key: 'footnote',
      icon: <BookOpen className="h-4 w-4" />,
      label: t.brew.noteToolFootnote,
      run: () => {
        const note = insertFootnoteMarkdown(
          (contentMd.match(/\[\^\d+\]/g)?.length ?? 0) + 1,
        )
        if (pane === 'visual') {
          const next = `${contentMd.trimEnd()}\n\n${note.mark} ${note.definition}`
          syncVisualFromMarkdown(next)
          return
        }
        insertText(note.mark, '', '')
        setContentMd((current) => `${current.trimEnd()}\n\n${note.definition}`)
      },
    },
  ]

  const { marks, inserts } = splitNoteTools(tools)
  /**
   * 「+」在有字的行上也能用：标题 / 列表 / 引用这类作用在当前行；
   * 图片 / 代码块 / 表格 / 分隔线 / 脚注这类块级插入先在下面开一行再落。
   */
  const openBlockBelow = useCallback(() => {
    const root = visualRef.current
    if (paneRef.current === 'visual' && root) {
      visualOpenBlockBelow(root)
      return
    }
    const el = textareaRef.current
    if (!el) return
    const opened = openLineBelow(el.value, el.selectionStart)
    if (opened.value !== el.value) {
      // 直接改 DOM 值，后面的工具读的是 el.value，不用等一帧。
      el.setRangeText('\n', opened.caret - 1, opened.caret - 1, 'end')
      setContentMd(el.value)
    }
    el.setSelectionRange(opened.caret, opened.caret)
  }, [])

  const placeWidget = useCallback(
    (type: string, size: string) => {
      setWidgetPickerOpen(false)
      const root = visualRef.current
      if (paneRef.current === 'visual' && root) {
        restoreVisualRange()
        openBlockBelow()
        commitVisualMd(insertWidgetVisual(root, type, size))
        const last = [...root.querySelectorAll<HTMLElement>('.note-widget')].at(-1)
        if (last) {
          selectWidget(last)
          const entry = widgetCatalog.find((item) => item.id === type)
          if (entry?.settings?.length) setWidgetSettingsOpen(true)
        }
        return
      }
      openBlockBelow()
      insertText(insertWidgetMarkdown(type, size), '', '')
    },
    [insertText, openBlockBelow, restoreVisualRange, selectWidget, widgetCatalog, commitVisualMd],
  )

  const onOwnLine = (tool: NoteEditorTool): NoteEditorTool => ({
    ...tool,
    run: () => {
      openBlockBelow()
      tool.run()
    },
    runWith: tool.runWith
      ? (value) => {
          openBlockBelow()
          tool.runWith?.(value)
        }
      : undefined,
  })

  const insertItems: NoteEditorTool[] = [
    onOwnLine({
      key: 'image',
      icon: <Image className="h-4 w-4" />,
      label: t.brew.noteToolImage,
      run: () => fileRef.current?.click(),
    }),
    onOwnLine({
      key: 'image-url',
      icon: <ImagePlus className="h-4 w-4" />,
      label: t.brew.noteImageByUrl,
      prompt: t.brew.noteImageUrlPlaceholder,
      run: () => {},
      runWith: (url) => placeImage(url, ''),
    }),
    ...[1, 2, 3].map((level) => ({
      key: `h${level}-block`,
      icon: <span aria-hidden="true">H{level}</span>,
      label: t.brew[`noteToolH${level}` as 'noteToolH1' | 'noteToolH2' | 'noteToolH3'],
      run: () => heading(level),
    })),
    ...inserts.map((tool) =>
      ['code', 'table', 'divider', 'footnote'].includes(tool.key) ? onOwnLine(tool) : tool,
    ),
    onOwnLine({
      key: 'columns',
      icon: <Columns2 className="h-4 w-4" />,
      label: t.brew.noteToolColumns,
      run: () => {
        const root = visualRef.current
        if (paneRef.current === 'visual' && root) {
          commitVisualMd(insertColumnsVisual(root))
          return
        }
        insertText(insertColumnsMarkdown(), '', '')
      },
    }),
    {
      key: 'widget',
      icon: <Puzzle className="h-4 w-4" />,
      label: t.brew.noteToolWidget,
      run: () => {
        rememberVisualRange()
        setInsertMenu(null)
        setWidgetPickerOpen(true)
      },
    },
  ]

  const canDelete =
    noteId !== undefined || (cloudId != null && docStatus !== 'published')

  return createPortal(
    <motion.div
      data-brew-shortcuts="suspended"
      className="brew-skin brew-note"
      initial={motionEnabled ? brewAnimationPresets.readerEnter.initial : false}
      animate={brewAnimationPresets.readerEnter.animate}
      exit={brewAnimationPresets.readerEnter.exit}
      transition={getBrewTransition(animation)}
    >
      <div className="brew-note__frame">
        <NoteTopBar
          docStatus={docStatus}
          lastError={lastError}
          scheduledAt={scheduledAt}
          cloudHint={cloudHint}
          peers={peers}
          saving={saving}
          loading={loading}
          onPublish={() => {
            void handleSave()
          }}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
          onClose={requestClose}
        />

        <div className="brew-note__scroll" ref={scrollRef}>
          {loading ? (
            <div className="brew-note__center">
              <Spinner size="lg" />
            </div>
          ) : (
            <article className="brew-note__paper">
              <textarea
                ref={titleInputRef}
                className="brew-note__title"
                rows={1}
                value={title}
                onChange={(e) => setTitle(e.target.value.replaceAll('\n', ''))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  focusBody()
                }}
                placeholder={t.brew.noteTitlePlaceholder}
                aria-label={t.brew.noteTitlePlaceholder}
                spellCheck={false}
              />
              <NoteByline
                topic={topic}
                publishedAt={publishedAt}
                scheduledAt={scheduledAt}
                docStatus={docStatus}
                onOpenSettings={() => setSettingsOpen(true)}
              />

              <div
                className={`brew-note__write brew-note__source${pane === 'write' ? '' : ' is-hidden'}`}
              >
                {peers.map((peer) =>
                  peer.cursor == null ? null : (
                    <span
                      key={peer.peerId}
                      className="brew-note__caret"
                      style={
                        {
                          ...caretOffsetStyle(contentMd, peer.cursor),
                          '--peer-hue': peerHue(peer.peerId),
                        } as CSSProperties
                      }
                      title={peer.name ?? undefined}
                    />
                  ),
                )}
                <textarea
                  ref={textareaRef}
                  value={contentMd}
                  onChange={(e) => {
                    setContentMd(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    // 用指针点开的插入菜单，一继续敲字就收掉。
                    if (insertMenu === 'pointer') setInsertMenu(null)
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const outdent = e.shiftKey
                      applyEdit((v, s, end) => indentLines(v, s, end, outdent))
                      return
                    }
                    if (e.key === 'Enter' && e.shiftKey) {
                      e.preventDefault()
                      applyEdit(hardBreak)
                      return
                    }
                    slashTrigger(e, () => {
                      const el = e.currentTarget
                      return (
                        el.selectionStart === el.selectionEnd &&
                        lineIsBlank(el.value, el.selectionStart)
                      )
                    })
                  }}
                  onPaste={(e) => {
                    const file = [...e.clipboardData.files].find((item) =>
                      item.type.startsWith('image/'),
                    )
                    if (file) {
                      e.preventDefault()
                      void handleUpload(file, 'body')
                      return
                    }
                    if (pasteAsLink(e.clipboardData.getData('text/plain'))) {
                      e.preventDefault()
                    }
                  }}
                  onDrop={(e) => {
                    const file = [...e.dataTransfer.files].find((item) =>
                      item.type.startsWith('image/'),
                    )
                    if (!file) return
                    e.preventDefault()
                    void handleUpload(file, 'body')
                  }}
                  placeholder={t.brew.noteBodyPlaceholder}
                  aria-label={t.brew.noteBodyPlaceholder}
                  spellCheck={false}
                />
              </div>
              <div
                className={`brew-note__write${pane === 'visual' ? '' : ' is-hidden'}`}
              >
                <div
                  ref={visualRef}
                  className="brew-note-preview brew-note__visual"
                  style={readerSurfaceStyle}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label={t.brew.noteTabVisual}
                  data-placeholder={t.brew.noteBodyPlaceholder}
                  onFocus={() => {
                    visualEditing.current = true
                  }}
                  onBlur={(e) => {
                    const next = e.relatedTarget as HTMLElement | null
                    if (
                      next?.closest('.brew-note__blockbar') ||
                      next?.closest('.widget-settings-tip') ||
                      widgetSettingsOpenRef.current
                    ) {
                      visualEditing.current = true
                      return
                    }
                    visualEditing.current = false
                    selectImage(null)
                    selectWidget(null)
                  }}
                  onPaste={(e) => {
                    const file = [...e.clipboardData.files].find((item) =>
                      item.type.startsWith('image/'),
                    )
                    if (file) {
                      e.preventDefault()
                      void handleUpload(file, 'body')
                      return
                    }
                    const text = e.clipboardData.getData('text/plain')
                    if (pasteAsLink(text)) {
                      e.preventDefault()
                      return
                    }
                    // 贴的是 Markdown（没带 HTML）：按 Markdown 解，图片就是图片。
                    if (!e.clipboardData.getData('text/html') && looksLikeMarkdown(text)) {
                      e.preventDefault()
                      commitVisualMd(pasteMarkdownIntoVisual(e.currentTarget, text))
                    }
                  }}
                  onKeyDown={(e) => {
                    const root = e.currentTarget
                    if (selectedImageRef.current) selectImage(null)
                    if (selectedWidgetRef.current) selectWidget(null)
                    if (insertMenu === 'pointer') setInsertMenu(null)
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const cell =
                        visualClosest(root, 'td') ?? visualClosest(root, 'th')
                      if (cell) {
                        const changed = tableStep(root, cell, e.shiftKey)
                        if (changed != null) {
                          commitVisualMd(changed)
                        }
                        return
                      }
                      if (visualClosest(root, 'li')) {
                        runVisual(e.shiftKey ? 'outdent' : 'indent')
                      }
                      return
                    }
                    if (e.nativeEvent.isComposing) return
                    if (e.key === ' ' || e.key === 'Enter') {
                      const blockEl = visualBlockAt(root)
                      if (blockEl === root && root.childElementCount > 0) return
                      const text = (blockEl.textContent ?? '').replaceAll('\u00A0', ' ')
                      const rule =
                        e.key === ' '
                          ? textBeforeCaret(root, blockEl).replaceAll('\u00A0', ' ') === text
                            ? matchSpaceRule(text)
                            : null
                          : matchEnterRule(text)
                      if (rule) {
                        e.preventDefault()
                        commitVisualMd(applyVisualInputRule(root, blockEl, rule))
                        return
                      }
                    }
                    slashTrigger(e, () => visualEmptyLineRect(root) != null)
                  }}
                  onClick={(e) => {
                    const root = e.currentTarget
                    const target = e.target as HTMLElement
                    const widget = target.closest<HTMLElement>('.note-widget')
                    if (widget && root.contains(widget)) {
                      selectWidget(widget)
                      selectImage(null)
                      return
                    }
                    selectWidget(null)
                    selectImage(target instanceof HTMLImageElement ? target : null)
                    if (footnoteJump(root, target)) {
                      e.preventDefault()
                      return
                    }
                    const item = target.closest<HTMLElement>('li[data-task]')
                    if (!item || target !== item || !root.contains(item)) return
                    // 勾选框画在 li 内容区左边的 ::before 上，点在内容左侧就是点它。
                    if (e.clientX < item.getBoundingClientRect().left) {
                      e.preventDefault()
                      commitVisualMd(toggleVisualTask(root, item))
                    }
                  }}
                  onInput={(e) => {
                    const root = e.currentTarget as HTMLDivElement
                    // 敲完 `)` / `` ` `` / `*` / `~`：光标前刚好凑成 Markdown 记号就地渲染。
                    const typed = (e.nativeEvent as InputEvent).data ?? ''
                    if (/[)`*~]/.test(typed)) {
                      const converted = applyInlineMarkdownAtCaret(root)
                      if (converted != null) {
                        commitVisualMd(converted)
                        return
                      }
                    }
                    commitVisualMd(visualHtmlToMarkdown(root.innerHTML))
                  }}
                />
              </div>
              <div
                className={`brew-note__read${pane === 'preview' ? '' : ' is-hidden'}`}
                onClick={jumpFromPreview}
              >
                {previewing && !html ? (
                  <div className="brew-note__center">
                    <Spinner size="md" />
                  </div>
                ) : null}
                {!html && !previewing && !contentMd.trim() ? (
                  <p className="brew-note__empty">{t.brew.notePreviewEmpty}</p>
                ) : null}
                <div
                  className={previewSurfaceClass}
                  style={readerSurfaceStyle}
                  hidden={!html}
                >
                  <div ref={previewRef} />
                </div>
              </div>
            </article>
          )}
          <NoteBubble
            anchor={selectionAnchor}
            tools={marks}
            active={activeMarks}
            containerRef={scrollRef}
            linkOpen={linkOpen}
            linkInitial={linkInitial}
            onLinkOpenChange={(open) => {
              if (open) openLink()
              else closeOverlays()
            }}
            onLink={applyLink}
          />
          <NoteBlockBar
            block={
              selectedWidget
                ? { kind: 'widget', anchor: selectedWidget.anchor }
                : selectedImage
                  ? { kind: 'img', anchor: selectedImage.anchor }
                  : selectionAnchor
                    ? null
                    : block
            }
            codeLang={codeLang}
            onCodeLangChange={changeCodeLang}
            columnAlign={columnAlign}
            onTableAlign={(align) => {
              setColumnAlign(align)
              tableOp((root, table) => tableSetAlign(root, table, align))
            }}
            onTableAddRow={() => tableOp(tableAddRow)}
            onTableAddColumn={() => tableOp(tableAddColumn)}
            onTableRemoveRow={() => tableOp(tableRemoveRow)}
            onTableRemoveColumn={() => tableOp(tableRemoveColumn)}
            onTableRemove={() => tableOp(tableRemove)}
            imageAlt={selectedImage?.alt ?? ''}
            onImageAltChange={(alt) => {
              setSelectedImage((current) => (current ? { ...current, alt } : current))
              imageOp((root, img) => setImageAlt(root, img, alt))
            }}
            onImageReplace={() => imageReplaceRef.current?.click()}
            onImageRemove={() => imageOp(removeImage, false)}
            onColumnsAdd={() => columnsOp(columnsAddColumn)}
            onColumnsRemoveCol={() => columnsOp(columnsRemoveColumn)}
            onColumnsRemove={() => columnsOp(columnsRemove)}
            widgetSize={selectedWidget?.size ?? ''}
            widgetSizes={selectedWidgetSizes}
            onWidgetSize={(size) => {
              widgetOp((root, widget) => setNoteWidgetSize(root, widget, size))
              setSelectedWidget((current) =>
                current ? { ...current, size } : current,
              )
            }}
            canConfigure={canConfigureWidget}
            widgetConfigOpen={widgetSettingsOpen}
            onWidgetConfig={() => {
              if (selectedWidgetSettings.length) {
                setWidgetSettingsOpen((open) => !open)
                return
              }
              setWidgetSettingsOpen(true)
              requestAnimationFrame(() => {
                selectedWidgetRef.current
                  ?.querySelector<HTMLButtonElement>('.widget-longpress-hint')
                  ?.click()
              })
            }}
            onWidgetRemove={() => widgetOp(removeNoteWidget, false)}
            onFocusChange={setBlockFocus}
            barRef={blockBarRef}
          />
          {selectedWidgetSettings.length > 0 ? (
            <WidgetInstanceSettings
              open={widgetSettingsOpen}
              title={
                selectedWidgetEntry
                  ? widgetDisplayLabel(
                      selectedWidgetEntry,
                      t.widgets as unknown as Record<string, unknown>,
                    )
                  : t.brew.noteWidgetConfig
              }
              settings={selectedWidgetSettings}
              value={
                decodeWidgetConfigAttr(selectedWidgetRef.current?.dataset.config) ??
                {}
              }
              anchor={
                selectedWidgetRef.current?.getBoundingClientRect() ?? null
              }
              ignoreRef={blockBarRef}
              onSave={(next) => {
                widgetOp((root, widget) => setNoteWidgetConfig(root, widget, next))
                setWidgetSettingsOpen(false)
                visualRef.current?.focus()
              }}
              onClose={() => {
                setWidgetSettingsOpen(false)
                visualRef.current?.focus()
              }}
            />
          ) : null}
          <NoteWidgetPicker
            open={widgetPickerOpen}
            widgets={widgetCatalog}
            onPick={placeWidget}
            onClose={closeOverlays}
          />
          <NoteGutter
            caretLine={caretLine}
            menu={insertMenu}
            onMenuChange={setInsertMenu}
            items={insertItems}
            busy={uploading}
          />
        </div>

        <NoteFootBar
          chars={bodyChars}
          pane={pane}
          onPaneChange={setPane}
        />

        <NoteSettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          docStatus={docStatus}
          topic={topic}
          topicChoices={categoryNames}
          onTopicChange={setTopic}
          onCreateTopic={(name) => {
            const next = normalizeNoteCategory(name)
            if (!next) return
            setTopic(next)
            setCategoryNames((prev) =>
              collectNoteCategories([...prev.map((item) => ({ topic: item })), { topic: next }]),
            )
            void brewApi.createCategory({ name: next }).catch(() => {})
          }}
          publishedAt={publishedAt}
          onPublishedAtChange={setPublishedAt}
          scheduledAt={scheduledAt}
          onScheduledAtChange={setScheduledAt}
          canSchedule={cloudId != null}
          busy={saving || loading}
          onSchedule={() => {
            void handleSchedule()
          }}
          onUnschedule={() => {
            void handleUnschedule()
          }}
          cover={cover}
          coverPreview={coverPreview}
          uploading={uploading}
          onPickCover={() => coverFileRef.current?.click()}
          onClearCover={() => setCover(null)}
          canDelete={canDelete}
          onDelete={() => {
            void handleDelete()
          }}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="brew-bar__file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleUpload(file, 'body')
        }}
      />
      <input
        ref={coverFileRef}
        type="file"
        accept="image/*"
        className="brew-bar__file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleUpload(file, 'cover')
        }}
      />
      <input
        ref={imageReplaceRef}
        type="file"
        accept="image/*"
        className="brew-bar__file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleUpload(file, 'replace')
        }}
      />
      {visualWidgets.portals}
      {previewWidgets.portals}
    </motion.div>,
    document.body,
  )
}
