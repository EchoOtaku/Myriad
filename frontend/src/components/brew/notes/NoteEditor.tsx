/** 预览与发布仍走后端渲染。可视层只改 Markdown 原文。 */

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { NoteCollabEvent, NoteCollabPeer } from './noteCollab'
import type { NoteEditorPane, NoteInsertMenuState } from './NoteEditorChrome'
import type { SelectionAnchor } from './noteSelection'
import {
  LuBold as Bold,
  LuBookOpen as BookOpen,
  LuCheckSquare as CheckSquare,
  LuCode as Code,
  LuFileText as FileText,
  LuImage as Image,
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
  indentLines,
  prefixLines,
  readNoteDraft,
  setHeadingLevel,
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
import { caretOffsetStyle, mergeNoteField, mergeNoteText } from './noteMerge'
import {
  lineIsBlank,

  visualEmptyLineRect,
} from './noteSelection'
import {
  applyVisualInputRule,
  insertFootnoteMarkdown,
  insertTableMarkdown,
  markdownToVisualHtml,
  runVisualCommand,
  setCodeLang as setVisualCodeLang,
  tableAddColumn,
  tableAddRow,
  tableRemove,
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
import { useNoteSelection } from './useNoteSelection'
import '../ui/brew.css'
import './NoteEditor.css'

const PREVIEW_DEBOUNCE_MS = 260
const DRAFT_SAVE_MS = 800

export interface NoteEditorProps {
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
  const [cloudId, setCloudId] = useState<number | null>(docId ?? null)
  const [revision, setRevision] = useState(1)
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
  const activeBlockRef = useRef<HTMLElement | null>(null)
  const selectionRef = useRef<SelectionAnchor | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)
  const skipCloudSave = useRef(true)
  const visualEditing = useRef(false)
  const revisionRef = useRef(1)
  const titleRef = useRef('')
  const contentMdRef = useRef('')
  const topicRef = useRef<string | null>(null)
  const coverRef = useRef<string | null>(null)
  const baseRef = useRef({
    title: '',
    contentMd: '',
    topic: null as string | null,
    cover: null as string | null,
  })
  const paneRef = useRef<Pane>('write')
  const wsRef = useRef<WebSocket | null>(null)
  const coverPreview = cover || firstMarkdownImage(contentMd)
  revisionRef.current = revision
  titleRef.current = title
  contentMdRef.current = contentMd
  topicRef.current = topic
  coverRef.current = cover
  paneRef.current = pane
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
        setCloudId(doc.id)
        setRevision(doc.revision)
        setDocStatus(doc.status)
        setScheduledAt(doc.scheduled_at)
        setTitle(next.title)
        setContentMd(next.contentMd)
        setTopic(next.topic)
        setCover(next.cover)
        setPublishedAt(next.publishedAt)
        setSaved(next)
        baseRef.current = {
          title: next.title,
          contentMd: next.contentMd,
          topic: next.topic,
          cover: next.cover,
        }
        setLastError(doc.last_error ?? null)
        if (doc.last_error) {
          setError(userFacingError(doc.last_error, t.brew.noteScheduleFailed))
        }
        skipCloudSave.current = true
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

  useEffect(() => {
    if (pane !== 'visual') return
    if (visualEditing.current) return
    const el = visualRef.current
    if (!el) return
    const next = markdownToVisualHtml(contentMd)
    if (el.innerHTML !== next) el.innerHTML = next
  }, [pane, contentMd])

  useEffect(() => {
    if (loading || cloudId == null) return
    if (skipCloudSave.current) {
      skipCloudSave.current = false
      return
    }
    const timer = setTimeout(async () => {
      try {
        const savedDoc = await brewApi.updateNoteDoc(cloudId, {
          title,
          content_md: contentMd,
          topic,
          image: cover,
          published_at: publishedAt,
          revision,
        })
        setRevision(savedDoc.revision)
        setDocStatus(savedDoc.status)
        setScheduledAt(savedDoc.scheduled_at)
        setLastError(savedDoc.last_error ?? null)
        if (!savedDoc.last_error) setError(null)
        setCloudHint(true)
        baseRef.current = {
          title,
          contentMd,
          topic,
          cover,
        }
      } catch (err) {
        const message = userFacingError(err, t.brew.errorSaveFailed)
        if (message === t.brew.noteRevisionConflict) {
          try {
            const fresh = await brewApi.getNoteDoc(cloudId)
            const mergedTitle = mergeNoteText(
              baseRef.current.title,
              title,
              fresh.title,
            )
            const mergedBody = mergeNoteText(
              baseRef.current.contentMd,
              contentMd,
              fresh.content_md,
            )
            const mergedTopic = mergeNoteField(
              baseRef.current.topic,
              topic,
              fresh.topic,
            )
            const mergedCover = mergeNoteField(
              baseRef.current.cover,
              cover,
              fresh.image,
            )
            skipCloudSave.current = true
            setTitle(mergedTitle)
            setContentMd(mergedBody)
            setTopic(mergedTopic)
            setCover(mergedCover)
            setPublishedAt(fresh.published_at)
            setRevision(fresh.revision)
            setDocStatus(fresh.status)
            setScheduledAt(fresh.scheduled_at)
            setError(t.brew.noteRevisionConflict)
            const persisted = await brewApi.updateNoteDoc(cloudId, {
              title: mergedTitle,
              content_md: mergedBody,
              topic: mergedTopic,
              image: mergedCover,
              published_at: fresh.published_at,
              revision: fresh.revision,
            })
            setRevision(persisted.revision)
            setDocStatus(persisted.status)
            setLastError(persisted.last_error ?? null)
            setCloudHint(true)
            baseRef.current = {
              title: mergedTitle,
              contentMd: mergedBody,
              topic: mergedTopic,
              cover: mergedCover,
            }
          } catch {
            setError(message)
          }
        }
      }
    }, DRAFT_SAVE_MS)
    return () => clearTimeout(timer)
  }, [
    cloudId,
    title,
    contentMd,
    topic,
    cover,
    publishedAt,
    revision,
    loading,
    t.brew.errorSaveFailed,
    t.brew.noteRevisionConflict,
  ])

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
          const mergedTitle = mergeNoteText(
            baseRef.current.title,
            titleRef.current,
            incoming.title ?? titleRef.current,
          )
          const mergedBody = mergeNoteText(
            baseRef.current.contentMd,
            contentMdRef.current,
            incoming.content_md,
          )
          skipCloudSave.current = true
          setTitle(mergedTitle)
          setContentMd(mergedBody)
          setTopic(
            mergeNoteField(
              baseRef.current.topic,
              topicRef.current,
              incoming.topic ?? topicRef.current,
            ),
          )
          setCover(
            mergeNoteField(
              baseRef.current.cover,
              coverRef.current,
              incoming.image ?? coverRef.current,
            ),
          )
          if (incoming.revision != null) setRevision(incoming.revision)
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

  const wrap = useCallback(
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

  const handleUpload = useCallback(
    async (file: File, as: 'body' | 'cover') => {
      setUploading(true)
      setError(null)
      try {
        const uploaded = await federationApi.uploadMedia(file, {
          filename: file.name,
        })
        if (as === 'cover') { setCover(uploaded.url)
}
        else if (paneRef.current === 'visual') {
          runVisual(
            'insertHTML',
            `<img src="${uploaded.url}" alt="${file.name}">`,
          )
        } else { wrap(`![${file.name}](${uploaded.url})`, '', '')
}
      } catch (err) {
        setError(userFacingError(err, t.brew.errorSaveFailed))
      } finally {
        setUploading(false)
      }
    },
    [wrap, runVisual, t.brew.errorSaveFailed],
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
    const payload = toNoteWritePayload(
      title,
      contentMd,
      topic,
      cover,
      publishedAt,
    )
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
      setDocStatus(doc.status)
      setScheduledAt(doc.scheduled_at)
      setRevision(doc.revision)
      setLastError(doc.last_error ?? null)
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
      setDocStatus(doc.status)
      setScheduledAt(null)
      setRevision(doc.revision)
      setLastError(doc.last_error ?? null)
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
    if (paneRef.current === 'visual' && root) {
      const selection = document.getSelection()
      savedRangeRef.current =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).cloneRange()
          : null
      setLinkInitial(visualClosest(root, 'a')?.getAttribute('href') ?? '')
    } else {
      setLinkInitial('')
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
      if (url) wrap('[', `](${url})`, t.brew.noteToolLink)
      else textareaRef.current?.focus()
    },
    [restoreVisualRange, runVisual, wrap, t.brew.noteToolLink],
  )

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
        if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
          e.preventDefault()
          heading(Number(e.code.slice(-1)))
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
        wrap(note.mark, '', '')
        setContentMd((current) => `${current.trimEnd()}\n\n${note.definition}`)
      },
    },
  ]

  const { marks, inserts } = splitNoteTools(tools)
  const insertItems = [
    {
      key: 'image',
      icon: <Image className="h-4 w-4" />,
      label: t.brew.noteToolImage,
      run: () => fileRef.current?.click(),
    },
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
                    if (!file) return
                    e.preventDefault()
                    void handleUpload(file, 'body')
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
                  onKeyDown={(e) => {
                    const root = e.currentTarget
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
            block={selectionAnchor ? null : block}
            codeLang={codeLang}
            onCodeLangChange={changeCodeLang}
            onTableAddRow={() => tableOp(tableAddRow)}
            onTableAddColumn={() => tableOp(tableAddColumn)}
            onTableRemove={() => tableOp(tableRemove)}
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
    </motion.div>,
    document.body,
  )
}
