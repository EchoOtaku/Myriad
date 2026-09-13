/** 预览与发布仍走后端渲染。可视层只改 Markdown 原文。 */

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  LuFileText as FileText,
  LuImage as Image,
  LuImagePlus as ImagePlus,
  LuItalic as Italic,
  LuLink as Link,
  LuList as List,
  LuListOrdered as ListOrdered,
  LuMinus as Minus,
  LuQuote as Quote,
  LuSquareCode as SquareCode,
  LuStrikethrough as Strikethrough,
} from '@lib/icons'

import { motionShim as motion } from '@lib/motionShim'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useI18n } from '../../../contexts/I18nContext'
import { brewAnimationPresets, getBrewTransition, useBrewAnimationConfig } from '../../../hooks/animation/pages/brew'
import { isExlight } from '../../../hooks/useAnimationLevel'
import * as brewApi from '../../../services/brewApi'
import { federationApi } from '../../../services/federationApi'
import { highlightCodeBlocks } from '../../../utils/codeHighlight'
import { userFacingError } from '../../../utils/userFacingError'
import { Spinner } from '../../Spinner'
import { noteTopicChoices } from '../logic/topics'
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
import { matchEnterRule, matchSpaceRule } from './noteInputRules'
import { caretOffsetStyle } from './noteMerge'
import {
  anchorInContainer,
  lineIsBlank,
  visualEmptyLineRect,
} from './noteSelection'
import {
  applyVisualInputRule,
  currentColumnAlign,
  insertFootnoteMarkdown,
  insertImage,
  insertTableMarkdown,
  markdownToVisualHtml,
  removeImage,
  runVisualCommand,
  setImageAlt,
  setImageSrc,
  setCodeLang as setVisualCodeLang,
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
  visualHtmlToMarkdown,
  withCodeLangLabels,
} from './noteVisual'
import { openNoteCloudDoc } from './useNoteCloud'
import {
  cloudFieldsOf,
  mergeCloudFields,

  useNoteCloudSave,
} from './useNoteCloudSave'
import { useNoteSelection } from './useNoteSelection'
import '../ui/brew.css'
import './NoteEditor.css'

const PREVIEW_DEBOUNCE_MS = 260
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
  const animation = useBrewAnimationConfig()
  const motionEnabled = !isExlight(animation)
  const draftKey = noteId ?? 'new'
  const topicChoices = useMemo(() => noteTopicChoices(), [])

  const [title, setTitle] = useState('')
  const [contentMd, setContentMd] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [publishedAt, setPublishedAt] = useState<number | null>(null)
  const [saved, setSaved] = useState<NoteSnapshot>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const [previewing, setPreviewing] = useState(false)
  /** 写 / 可视是两种输入法；预览是顶栏开关，关掉回到上一种。 */
  const [pane, setPane] = useState<Pane>('write')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [insertMenu, setInsertMenu] = useState<NoteInsertMenuState>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkInitial, setLinkInitial] = useState('')
  const [blockFocus, setBlockFocus] = useState(false)
  const [codeLang, setCodeLang] = useState('')
  const [columnAlign, setColumnAlign] = useState<TableAlign>(null)
  const [selectedImage, setSelectedImage] = useState<{
    anchor: SelectionAnchor
    alt: string
  } | null>(null)
  const [cloudId, setCloudId] = useState<number | null>(docId ?? null)
  const [docStatus, setDocStatus] = useState<'draft' | 'scheduled' | 'published'>('draft')
  const [scheduledAt, setScheduledAt] = useState<number | null>(null)
  const [peers, setPeers] = useState<NoteCollabPeer[]>([])
  const [cloudHint, setCloudHint] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const visualRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editPaneRef = useRef<'write' | 'visual'>('write')
  const overlayOpenRef = useRef(false)
  const savedRangeRef = useRef<Range | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const activeBlockRef = useRef<HTMLElement | null>(null)
  const selectionRef = useRef<SelectionAnchor | null>(null)
  const selectedImageRef = useRef<HTMLImageElement | null>(null)
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
  const coverPreview = cover || firstMarkdownImage(contentMd)
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
    setTitle(fields.title)
    setContentMd(fields.contentMd)
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
    onSaved: () => setCloudHint(true),
    onError: setError,
    labels: {
      saveFailed: t.brew.errorSaveFailed,
      conflict: t.brew.noteRevisionConflict,
    },
  })
  const baseRef = cloud.baseRef
  if (pane !== 'preview') editPaneRef.current = pane
  overlayOpenRef.current = settingsOpen || insertMenu != null || linkOpen

  const {
    selection: selectionAnchor,
    emptyLine,
    block,
  } = useNoteSelection(
    pane,
    scrollRef,
    textareaRef,
    visualRef,
    !loading,
    insertMenu != null || linkOpen || blockFocus,
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

  // 标题和写栏都随内容长高，滚动交给整页。
  useEffect(() => {
    if (loading) return
    const grow = (el: HTMLTextAreaElement | null) => {
      if (!el) return
      el.style.height = '0px'
      el.style.height = `${el.scrollHeight}px`
    }
    grow(titleInputRef.current)
    if (pane === 'write') grow(textareaRef.current)
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
        const localKey = noteId ?? docId ?? 'new'
        const draft = readNoteDraft(localKey)
        const useDraft = draftDiffersFrom(draft, server)
        const next: NoteSnapshot = {
          title: useDraft && draft ? draft.title : server.title,
          contentMd: useDraft && draft ? draft.contentMd : server.contentMd,
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
          setError(userFacingError(doc.last_error, t.brew.noteScheduleFailed))
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(userFacingError(err, t.brew.errorLoadFailed))
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

  // 预览防抖 + AbortController：只落地最后一次。
  useEffect(() => {
    if (loading) return
    if (!contentMd.trim()) {
      setHtml('')
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setPreviewing(true)
      try {
        const rendered = await brewApi.previewNote(contentMd, controller.signal)
        if (!controller.signal.aborted) setHtml(rendered)
      } catch {
        // 预览失败不打断写作。
      } finally {
        if (!controller.signal.aborted) setPreviewing(false)
      }
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [contentMd, loading])

  // 预览里的代码块上色，和阅读器同一套。
  useEffect(() => {
    if (pane !== 'preview' || !html) return
    const root = previewRef.current
    if (root) void highlightCodeBlocks(root)
  }, [pane, html])

  useEffect(() => {
    if (pane !== 'visual') return
    if (visualEditing.current) return
    const el = visualRef.current
    if (!el) return
    const next = markdownToVisualHtml(contentMd)
    if (el.innerHTML !== next) el.innerHTML = next
  }, [pane, contentMd])

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
    }
  }, [cloudId, user?.username])

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
      el.innerHTML = markdownToVisualHtml(next)
    }
  }, [])

  const runVisual = useCallback((command: string, value?: string) => {
    const root = visualRef.current
    if (!root) return
    setContentMd(runVisualCommand(root, command, value))
  }, [])

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
        setContentMd(insertImage(root, src, alt))
        return
      }
      insertText(`![${alt}](${src})`, '', '')
    },
    [insertText],
  )

  const handleUpload = useCallback(
    async (file: File, as: 'body' | 'cover' | 'replace') => {
      setUploading(true)
      setError(null)
      try {
        const uploaded = await federationApi.uploadMedia(file, {
          filename: file.name,
        })
        if (as === 'cover') {
          setCover(uploaded.url)
        } else if (as === 'replace') {
          const root = visualRef.current
          const img = selectedImageRef.current
          if (root && img) setContentMd(setImageSrc(root, img, uploaded.url))
        } else {
          placeImage(uploaded.url, file.name)
        }
      } catch (err) {
        setError(userFacingError(err, t.brew.errorSaveFailed))
      } finally {
        setUploading(false)
      }
    },
    [placeImage, t.brew.errorSaveFailed],
  )

  const handleSave = useCallback(async () => {
    if (saving) return
    const invalid = noteFieldError(title, contentMd)
    if (invalid) {
      setError(fieldMessage(invalid))
      return
    }
    setSaving(true)
    setError(null)
    // 正文里已经没人引用的脚注定义，发布时清掉；写作过程中不动。
    const body = pruneOrphanFootnotes(contentMd)
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
      setError(userFacingError(err, t.brew.errorSaveFailed))
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
      setError(fieldMessage(invalid))
      return
    }
    const timeError = noteScheduleError(scheduledAt)
    if (timeError === 'missing-time') {
      setError(t.brew.noteScheduleNeedTime)
      return
    }
    if (timeError === 'already-due') {
      setError(t.brew.noteSchedulePast)
      return
    }
    const when = scheduledAt
    if (when == null) return
    setSaving(true)
    setError(null)
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
      setError(userFacingError(err, t.brew.errorSaveFailed))
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
      setError(null)
    } catch (err) {
      setError(userFacingError(err, t.brew.errorSaveFailed))
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
      setError(userFacingError(err, t.brew.errorDeleteFailed))
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

  // Esc 关闭；有未保存改动时先确认。
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm(t.brew.noteDiscardConfirm)) return
    if (
      cloudId != null &&
      noteId === undefined &&
      docStatus === 'draft' &&
      !title.trim() &&
      !contentMd.trim()
    ) {
      void brewApi.deleteNoteDoc(cloudId)
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
  ])

  // ---- 格式动作：写栏改 Markdown，可视层改 DOM。快捷键、浮动条、菜单都走这几只 ----

  const heading = useCallback(
    (level: number) => {
      const root = visualRef.current
      if (paneRef.current === 'visual' && root) {
        setContentMd(toggleVisualHeading(root, level))
        return
      }
      applyEdit((v, s, e) => setHeadingLevel(v, s, e, level))
    },
    [applyEdit],
  )

  const inlineCode = useCallback(() => {
    const root = visualRef.current
    if (paneRef.current === 'visual' && root) {
      setContentMd(toggleVisualInlineCode(root))
      return
    }
    wrap('`', '`', t.brew.noteToolInlineCode)
  }, [wrap, t.brew.noteToolInlineCode])

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

  const imageOp = useCallback(
    (fn: (root: HTMLElement, img: HTMLImageElement) => string, keep = true) => {
      const root = visualRef.current
      const img = selectedImageRef.current
      if (!root || !img) return
      setContentMd(fn(root, img))
      if (!keep) selectImage(null)
    },
    [selectImage],
  )

  const footnoteJump = useCallback((root: HTMLElement, target: HTMLElement) => {
    const ref = target.closest<HTMLElement>('sup[data-fnref]')
    if (!ref) return false
    const definition = root.querySelector<HTMLElement>(`p[data-fn="${ref.dataset.fnref}"]`)
    definition?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return Boolean(definition)
  }, [])

  const closeOverlays = useCallback(() => {
    setSettingsOpen(false)
    setInsertMenu(null)
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
    const el = visualClosest(root, block.kind)
    activeBlockRef.current = el
    setCodeLang(el?.dataset.lang ?? '')
    setColumnAlign(el instanceof HTMLTableElement ? currentColumnAlign(root, el) : null)
  }, [block])

  const tableOp = useCallback(
    (fn: (root: HTMLElement, table: HTMLTableElement) => string) => {
      const root = visualRef.current
      const table = activeBlockRef.current
      if (!root || !(table instanceof HTMLTableElement)) return
      setContentMd(fn(root, table))
    },
    [],
  )

  const changeCodeLang = useCallback((lang: string) => {
    setCodeLang(lang)
    const root = visualRef.current
    const pre = activeBlockRef.current
    if (root && pre instanceof HTMLPreElement) {
      setContentMd(setVisualCodeLang(root, pre, lang))
    }
  }, [])

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
  const insertItems: NoteEditorTool[] = [
    {
      key: 'image',
      icon: <Image className="h-4 w-4" />,
      label: t.brew.noteToolImage,
      run: () => fileRef.current?.click(),
    },
    {
      key: 'image-url',
      icon: <ImagePlus className="h-4 w-4" />,
      label: t.brew.noteImageByUrl,
      prompt: t.brew.noteImageUrlPlaceholder,
      run: () => {},
      runWith: (url) => placeImage(url, ''),
    },
    ...[1, 2, 3].map((level) => ({
      key: `h${level}-block`,
      icon: <span aria-hidden="true">H{level}</span>,
      label: t.brew[`noteToolH${level}` as 'noteToolH1' | 'noteToolH2' | 'noteToolH3'],
      run: () => heading(level),
    })),
    ...inserts,
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
          pane={pane}
          onTogglePreview={() =>
            setPane(pane === 'preview' ? editPaneRef.current : 'preview')
          }
          saving={saving}
          loading={loading}
          onPublish={() => {
            void handleSave()
          }}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
          onClose={requestClose}
          error={error}
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
                topicChoices={topicChoices}
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
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label={t.brew.noteTabVisual}
                  data-placeholder={t.brew.noteBodyPlaceholder}
                  onFocus={() => {
                    visualEditing.current = true
                  }}
                  onBlur={() => {
                    visualEditing.current = false
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
                  onKeyDown={(e) => {
                    const root = e.currentTarget
                    if (selectedImageRef.current) selectImage(null)
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const cell =
                        visualClosest(root, 'td') ?? visualClosest(root, 'th')
                      if (cell) {
                        const changed = tableStep(root, cell, e.shiftKey)
                        if (changed != null) setContentMd(changed)
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
                        setContentMd(applyVisualInputRule(root, blockEl, rule))
                        return
                      }
                    }
                    slashTrigger(e, () => visualEmptyLineRect(root) != null)
                  }}
                  onClick={(e) => {
                    const root = e.currentTarget
                    const target = e.target as HTMLElement
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
                      setContentMd(toggleVisualTask(root, item))
                    }
                  }}
                  onInput={(e) => {
                    const next = visualHtmlToMarkdown(
                      (e.currentTarget as HTMLDivElement).innerHTML,
                    )
                    setContentMd(next)
                  }}
                />
              </div>
              <div
                className={`brew-note__read${pane === 'preview' ? '' : ' is-hidden'}`}
              >
                {previewing && !html ? (
                  <div className="brew-note__center">
                    <Spinner size="md" />
                  </div>
                ) : html ? (
                  <div
                    className="brew-note-preview"
                    ref={previewRef}
                    dangerouslySetInnerHTML={{ __html: withCodeLangLabels(html) }}
                  />
                ) : (
                  <p className="brew-note__empty">{t.brew.notePreviewEmpty}</p>
                )}
              </div>
            </article>
          )}
          <NoteBubble
            anchor={selectionAnchor}
            tools={marks}
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
              selectedImage
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
            onFocusChange={setBlockFocus}
          />
          <NoteGutter
            emptyLine={emptyLine}
            menu={insertMenu}
            onMenuChange={setInsertMenu}
            items={insertItems}
            busy={uploading}
          />
        </div>

        <NoteFootBar
          chars={countNoteChars(contentMd)}
          pane={pane}
          onPaneChange={setPane}
        />

        <NoteSettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          docStatus={docStatus}
          topic={topic}
          topicChoices={topicChoices}
          onTopicChange={setTopic}
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
    </motion.div>,
    document.body,
  )
}
