import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PhantasiNoteDoc } from '../../../types/phantasi'
import type { InlineLink } from './noteDraft'
import type {
  NoteEditorPane,
  NoteInsertMenuState,
  TableAlign,
} from './NoteEditorChrome'
import type { SelectionAnchor } from './noteSelection'
import type { NoteCloudFields } from './useNoteCloudSave'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useI18n } from '../../../contexts/I18nContext'
import { usePhantasiAnimationConfig } from '../../../hooks/animation/pages/phantasi'
import { isExlight } from '../../../hooks/useAnimationLevel'
import { showNoteNotice } from '../phantasiNotice'
import { getArticleProseClass } from '../reader/articleProseClass'
import { useReaderSettings } from '../reader/hooks/useReaderSettings'
import {
  prefixLines,
  toggleWrap,
  wrapSelection,
} from './noteDraft'
import {
  countNoteChars,
  firstMarkdownImage,
  normalizeNoteCover,
  normalizeNoteTopic,
  sameNoteMinute,
} from './noteFields'
import { displayImageUrl } from './noteImageUrl'
import { NOTE_WIDGET_SIZES, noteWidgetCanConfigure } from './noteLayout'
import { expandJammedDefinitions, setVisualImageResolver } from './noteVisual'
import { useNoteWidgetCatalog } from './noteWidgetCatalog'
import { useNoteCloudSave } from './useNoteCloudSave'
import { useNoteCollab } from './useNoteCollab'
import { useNoteEditorAuthors } from './useNoteEditorAuthors'
import { useNoteEditorFormat } from './useNoteEditorFormat'
import { useNoteEditorOpen } from './useNoteEditorOpen'
import { useNoteEditorPreview } from './useNoteEditorPreview'
import { useNoteEditorSidecar } from './useNoteEditorSidecar'
import { useNotePublish } from './useNotePublish'
import { useNoteSelection } from './useNoteSelection'
import { useNoteVisual } from './useNoteVisual'

// 富文本层里的图片：Markdown 存原地址，浏览器看本站 origin 上的那份。
setVisualImageResolver(displayImageUrl)

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

export interface NoteEditorProps {
  noteId?: number
  docId?: number
  onClose: () => void
  onSaved: (id: number) => void
  onDeleted?: (id: number) => void
}

export function useNoteEditorSession({
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
    () => `phantasi-note__article ${getArticleProseClass(isDark, currentTheme.text)}`,
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
  const animation = usePhantasiAnimationConfig()
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
  const {
    setAuthors,
    setAuthorCandidates,
    authorBusy,
    authorLine,
    authorChips,
    addableAuthors,
    handleAddAuthor,
    handleRemoveAuthor,
  } = useNoteEditorAuthors(cloudId, {
    addFailed: t.phantasi.noteAuthorAddFailed,
    removeFailed: t.phantasi.noteAuthorRemoveFailed,
  })
  const [scheduledAt, setScheduledAt] = useState<number | null>(null)
  const [cloudHint, setCloudHint] = useState(false)
  useEffect(() => {
    if (!cloudHint) return
    const timer = window.setTimeout(setCloudHint, 1600, false)
    return () => window.clearTimeout(timer)
  }, [cloudHint])

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
  const {
    syncVisualFromMarkdown,
    commitVisualMd,
    runVisual,
    visualHistoryStep,
  } = useNoteVisual({
    visualRef,
    visualEditing,
    historyRef,
    contentMd,
    contentMdRef,
    pane,
    paneRef,
    loading,
    setContentMd,
  })

  /** 服务端回的文档：只更新状态类字段，内容由云存 hook 管。 */
  const applyServerDoc = useCallback((doc: PhantasiNoteDoc) => {
    revisionRef.current = doc.revision
    setDocStatus(doc.status)
    setScheduledAt(doc.scheduled_at)
    setLastError(doc.last_error ?? null)
    if (doc.authors) setAuthors(doc.authors)
  }, [setAuthors])

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
        message === t.phantasi.noteRevisionConflict ? 'warning' : 'error',
      ),
    labels: {
      saveFailed: t.phantasi.errorSaveFailed,
      conflict: t.phantasi.noteRevisionConflict,
    },
  })
  const baseRef = cloud.baseRef
  const { peers } = useNoteCollab({
    cloudId,
    loading,
    userName: user?.username,
    revisionRef,
    titleRef,
    contentMdRef,
    topicRef,
    coverRef,
    publishedAtRef,
    textareaRef,
    baseRef,
    title,
    topic,
    cover,
    applyMergedFields,
    ackRemote: cloud.ack,
  })
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

  useNoteEditorSidecar({
    loadFailed: t.phantasi.errorLoadFailed,
    cloudId,
    settingsOpen,
    loading,
    pane,
    draftKey,
    title,
    contentMd,
    topic,
    cover,
    publishedAt,
    titleInputRef,
    textareaRef,
    setAuthors,
    setAuthorCandidates,
    setCategoryNames,
  })

  useNoteEditorOpen({
    noteId,
    docId,
    cloudAck: cloud.ack,
    applyServerDoc,
    applyMergedFields,
    setCloudId,
    setSaved,
    setLoading,
    loadFailed: t.phantasi.errorLoadFailed,
    scheduleFailed: t.phantasi.noteScheduleFailed,
  })

  const { visualWidgets, previewWidgets, jumpFromPreview } = useNoteEditorPreview({
    t,
    pane,
    loading,
    contentMd,
    html,
    htmlRef,
    previewMdRef,
    contentMdRef,
    previewRef,
    visualRef,
    textareaRef,
    visualEditing,
    lastEditPaneRef,
    pendingJumpRef,
    widgetCatalog,
    setHtml,
    setContentMd,
    setPreviewing,
    setPane,
  })

  // 切面板、进预览：浮着的东西全收——图片选中框、插入菜单、地址栏。
  useEffect(() => {
    selectedImageRef.current?.classList.remove('is-selected')
    selectedImageRef.current = null
    setSelectedImage(null)
    setInsertMenu(null)
    setLinkOpen(false)
  }, [pane])

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

  const {
    handleSave,
    handleSchedule,
    handleUnschedule,
    handleDelete,
    requestClose: closeEditor,
  } = useNotePublish({
    title,
    contentMd,
    topic,
    cover,
    publishedAt,
    scheduledAt,
    noteId,
    cloudId,
    draftKey,
    docStatus,
    saving,
    setSaving,
    setContentMd,
    setPublishedAt,
    revisionRef,
    applyServerDoc,
    ackCloud: cloud.ack,
    onSaved,
    onDeleted,
    onClose,
    format,
    labels: {
      titleRequired: t.phantasi.noteTitleRequired,
      titleTooLong: t.phantasi.noteTitleTooLong,
      bodyTooLong: t.phantasi.noteBodyTooLong,
      saveFailed: t.phantasi.errorSaveFailed,
      scheduleNeedTime: t.phantasi.noteScheduleNeedTime,
      schedulePast: t.phantasi.noteSchedulePast,
      deleteConfirm: t.phantasi.noteDeleteConfirm,
      deleteFailed: t.phantasi.errorDeleteFailed,
      discardConfirm: t.phantasi.noteDiscardConfirm,
    },
  })
  const requestClose = useCallback(() => {
    void closeEditor(dirty)
  }, [closeEditor, dirty])

  const {
    placeImage,
    handleUpload,
    heading,
    finishMath,
    displayMath,
    bold,
    italic,
    strike,
    inlineCode,
    inlineMath,
    openLink,
    rememberVisualRange,
    applyLink,
    pasteAsLink,
    selectImage,
    selectWidget,
    imageOp,
    footnoteJump,
    closeOverlays,
    tableOp,
    columnsOp,
    widgetOp,
    changeCodeLang,
    openBlockBelow,
    placeWidget,
    handleCreateTopic,
    bulletList,
    orderedList,
    taskList,
  } = useNoteEditorFormat({
    t,
    visualRef,
    textareaRef,
    scrollRef,
    paneRef,
    selectedImageRef,
    selectedWidgetRef,
    activeBlockRef,
    savedRangeRef,
    editingLinkRef,
    overlayOpenRef,
    selectionRef,
    widgetCatalog,
    visualWidgets,
    commitVisualMd,
    runVisual,
    visualHistoryStep,
    insertText,
    applyEdit,
    wrap,
    prefix,
    runTool,
    focusBody,
    requestClose,
    handleSave,
    setContentMd,
    setCover,
    setUploading,
    setTopic,
    setCategoryNames,
    setSettingsOpen,
    setInsertMenu,
    setWidgetPickerOpen,
    setWidgetSettingsOpen,
    setLinkOpen,
    setLinkInitial,
    setSelectedImage,
    setSelectedWidget,
    setCodeLang,
    setColumnAlign,
    block,
    contentMd,
  })

  const canDelete =
    noteId !== undefined || (cloudId != null && docStatus !== 'published')

  return {
    t,
    animation,
    motionEnabled,
    previewSurfaceClass,
    readerSurfaceStyle,
    cloudId,
    categoryNames,
    title,
    setTitle,
    contentMd,
    setContentMd,
    topic,
    setTopic,
    cover,
    setCover,
    publishedAt,
    setPublishedAt,
    loading,
    saving,
    uploading,
    lastError,
    html,
    previewing,
    pane,
    setPane,
    settingsOpen,
    setSettingsOpen,
    insertMenu,
    setInsertMenu,
    widgetPickerOpen,
    setWidgetPickerOpen,
    linkOpen,
    linkInitial,
    setBlockFocus,
    codeLang,
    columnAlign,
    setColumnAlign,
    selectedImage,
    setSelectedImage,
    selectedWidget,
    setSelectedWidget,
    widgetSettingsOpen,
    setWidgetSettingsOpen,
    docStatus,
    authorLine,
    authorChips,
    addableAuthors,
    authorBusy,
    scheduledAt,
    setScheduledAt,
    cloudHint,
    textareaRef,
    visualRef,
    titleInputRef,
    scrollRef,
    previewRef,
    selectedImageRef,
    selectedWidgetRef,
    widgetSettingsOpenRef,
    blockBarRef,
    widgetCatalog,
    imageReplaceRef,
    fileRef,
    coverFileRef,
    visualEditing,
    coverPreview,
    selectedWidgetEntry,
    selectedWidgetSizes,
    selectedWidgetSettings,
    canConfigureWidget,
    bodyChars,
    peers,
    selectionAnchor,
    activeMarks,
    caretLine,
    block,
    visualWidgets,
    previewWidgets,
    focusBody,
    slashTrigger,
    jumpFromPreview,
    applyEdit,
    runTool,
    wrap,
    prefix,
    insertText,
    handleSave,
    handleSchedule,
    handleUnschedule,
    handleDelete,
    requestClose,
    placeImage,
    handleUpload,
    heading,
    finishMath,
    displayMath,
    bold,
    italic,
    strike,
    inlineCode,
    inlineMath,
    openLink,
    rememberVisualRange,
    applyLink,
    pasteAsLink,
    selectImage,
    selectWidget,
    imageOp,
    footnoteJump,
    closeOverlays,
    tableOp,
    columnsOp,
    widgetOp,
    changeCodeLang,
    syncVisualFromMarkdown,
    commitVisualMd,
    runVisual,
    openBlockBelow,
    placeWidget,
    handleAddAuthor,
    handleRemoveAuthor,
    handleCreateTopic,
    bulletList,
    orderedList,
    taskList,
    paneRef,
    canDelete,
  }
}
