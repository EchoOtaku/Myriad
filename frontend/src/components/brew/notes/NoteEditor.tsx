/** 不做所见即所得：预览与发布走同一套后端渲染。dangerouslySetInnerHTML 只吃后端白名单消毒后的 HTML。 */

import {
  LuBold as Bold,
  LuCode as Code,
  LuHeading as Heading,
  LuImage as Image,
  LuItalic as Italic,
  LuLink as Link,
  LuList as List,
  LuQuote as Quote,
  LuTrash2 as Trash2,
  LuX as X,
} from '@lib/icons'
import { motionShim as motion } from '@lib/motionShim'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useI18n } from '../../../contexts/I18nContext'
import { brewAnimationPresets, getBrewTransition, useBrewAnimationConfig } from '../../../hooks/animation/pages/brew'
import { isExlight } from '../../../hooks/useAnimationLevel'
import * as brewApi from '../../../services/brewApi'
import { federationApi } from '../../../services/federationApi'
import { userFacingError } from '../../../utils/userFacingError'
import { Spinner } from '../../Spinner'
import { noteTopicChoices } from '../logic/topics'
import {
  clearNoteDraft,
  draftDiffersFrom,
  prefixLines,
  readNoteDraft,
  wrapSelection,
  writeNoteDraft,
} from './noteDraft'
import {
  countNoteChars,
  firstMarkdownImage,
  fromDatetimeLocal,
  MAX_NOTE_BODY_CHARS,
  MAX_NOTE_TITLE_CHARS,
  normalizeNoteCover,
  normalizeNoteTopic,
  noteFieldError,
  sameNoteMinute,
  toDatetimeLocal,
  toNoteWritePayload,
} from './noteFields'
import '../ui/brew.css'
import './NoteEditor.css'

const PREVIEW_DEBOUNCE_MS = 260
const DRAFT_SAVE_MS = 800

export interface NoteEditorProps {
  noteId?: number
  onClose: () => void
  onSaved: (id: number) => void
  onDeleted?: (id: number) => void
}

type Pane = 'write' | 'preview'

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
  onClose,
  onSaved,
  onDeleted,
}: NoteEditorProps) {
  const { t, format } = useI18n()
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
  const [loading, setLoading] = useState(Boolean(noteId))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const [previewing, setPreviewing] = useState(false)
  /** 窄屏一栏；宽屏两栏并排，此值不参与布局。 */
  const [pane, setPane] = useState<Pane>('write')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)
  const coverPreview = cover || firstMarkdownImage(contentMd)

  useEffect(() => {
    const controller = new AbortController()
    const run = async () => {
      if (noteId === undefined) {
        const draft = readNoteDraft('new')
        const now = Date.now()
        if (draft) {
          const next: NoteSnapshot = {
            title: draft.title,
            contentMd: draft.contentMd,
            topic: draft.topic ?? null,
            cover: draft.cover ?? null,
            publishedAt: draft.publishedAt ?? now,
          }
          setTitle(next.title)
          setContentMd(next.contentMd)
          setTopic(next.topic)
          setCover(next.cover)
          setPublishedAt(next.publishedAt)
          setSaved(next)
        } else {
          setPublishedAt(now)
          setSaved({ ...EMPTY_SNAPSHOT, publishedAt: now })
        }
        return
      }
      try {
        const note = await brewApi.getNoteDraft(noteId, controller.signal)
        if (controller.signal.aborted) return
        const server: NoteSnapshot = {
          title: note.title,
          contentMd: note.content_md,
          topic: normalizeNoteTopic(note.topic),
          cover: normalizeNoteCover(note.image),
          publishedAt: note.published_at,
        }
        setSaved(server)
        // 本地草稿比服务端新才用。旧草稿缺的字段仍跟服务端。
        const draft = readNoteDraft(noteId)
        const useDraft = draftDiffersFrom(draft, server)
        setTitle(useDraft && draft ? draft.title : server.title)
        setContentMd(useDraft && draft ? draft.contentMd : server.contentMd)
        setTopic(
          useDraft && draft && draft.topic !== undefined
            ? draft.topic
            : server.topic,
        )
        setCover(
          useDraft && draft && draft.cover !== undefined
            ? draft.cover
            : server.cover,
        )
        setPublishedAt(
          useDraft && draft && draft.publishedAt != null
            ? draft.publishedAt
            : server.publishedAt,
        )
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
  }, [noteId, t.brew.errorLoadFailed])

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
        if (as === 'cover') setCover(uploaded.url)
        else wrap(`![${file.name}](${uploaded.url})`, '', '')
      } catch (err) {
        setError(userFacingError(err, t.brew.errorSaveFailed))
      } finally {
        setUploading(false)
      }
    },
    [wrap, t.brew.errorSaveFailed],
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
      const result =
        noteId === undefined
          ? await brewApi.createNote(payload)
          : await brewApi.updateNote(noteId, payload)
      clearNoteDraft(draftKey)
      // 发布后清掉 `new` 草稿位。
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
    draftKey,
    onSaved,
    fieldMessage,
    t.brew.errorSaveFailed,
  ])

  const handleDelete = useCallback(async () => {
    if (noteId === undefined || saving) return

    if (!window.confirm(t.brew.noteDeleteConfirm)) return
    setSaving(true)
    try {
      await brewApi.deleteNote(noteId)
      clearNoteDraft(noteId)
      onDeleted?.(noteId)
    } catch (err) {
      setError(userFacingError(err, t.brew.errorDeleteFailed))
      setSaving(false)
    }
  }, [
    noteId,
    saving,
    onDeleted,
    t.brew.noteDeleteConfirm,
    t.brew.errorDeleteFailed,
  ])

  // Esc 关闭；有未保存改动时先确认。
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm(t.brew.noteDiscardConfirm)) return
    onClose()
  }, [dirty, onClose, t.brew.noteDiscardConfirm])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose, handleSave])

  const tools = [
    {
      key: 'heading',
      icon: <Heading className="h-4 w-4" />,
      label: t.brew.noteToolHeading,
      run: () => prefix('## '),
    },
    {
      key: 'bold',
      icon: <Bold className="h-4 w-4" />,
      label: t.brew.noteToolBold,
      run: () => wrap('**', '**', t.brew.noteToolBold),
    },
    {
      key: 'italic',
      icon: <Italic className="h-4 w-4" />,
      label: t.brew.noteToolItalic,
      run: () => wrap('*', '*', t.brew.noteToolItalic),
    },
    {
      key: 'link',
      icon: <Link className="h-4 w-4" />,
      label: t.brew.noteToolLink,
      run: () => wrap('[', '](https://)', t.brew.noteToolLink),
    },
    {
      key: 'code',
      icon: <Code className="h-4 w-4" />,
      label: t.brew.noteToolCode,
      run: () => wrap('\n```\n', '\n```\n', ''),
    },
    {
      key: 'quote',
      icon: <Quote className="h-4 w-4" />,
      label: t.brew.noteToolQuote,
      run: () => prefix('> '),
    },
    {
      key: 'list',
      icon: <List className="h-4 w-4" />,
      label: t.brew.noteToolList,
      run: () => prefix('- '),
    },
  ]

  return createPortal(
    <motion.div
      className="brew-skin brew-note"
      initial={motionEnabled ? brewAnimationPresets.readerEnter.initial : false}
      animate={brewAnimationPresets.readerEnter.animate}
      exit={brewAnimationPresets.readerEnter.exit}
      transition={getBrewTransition(animation)}
    >
      <div className="brew-note__frame">
        <div className="brew-note__head">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.brew.noteTitlePlaceholder}
            aria-label={t.brew.noteTitlePlaceholder}
            className="brew-note__title"
          />
          {noteId !== undefined ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="brew-note__tool is-danger"
              title={t.brew.noteDelete}
              aria-label={t.brew.noteDelete}
            >
              <Trash2 />
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="brew-note__publish"
          >
            {saving ? <Spinner size="sm" /> : null}
            {t.brew.notePublish}
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="brew-note__tool"
            title={t.brew.close}
            aria-label={t.brew.close}
          >
            <X />
          </button>
        </div>

        <div className="brew-note__tools">
          {tools.map((tool) => (
            <button
              key={tool.key}
              type="button"
              onClick={tool.run}
              className="brew-note__tool"
              title={tool.label}
              aria-label={tool.label}
            >
              {tool.icon}
            </button>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="brew-note__tool"
            title={t.brew.noteToolImage}
            aria-label={t.brew.noteToolImage}
          >
            {uploading ? <Spinner size="sm" /> : <Image />}
          </button>
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

          <div className="ml-auto flex items-center gap-0.5 lg:hidden">
            {(['write', 'preview'] as Pane[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPane(value)}
                aria-pressed={pane === value}
                className={`brew-note__pane${pane === value ? ' is-on' : ''}`}
              >
                {value === 'write' ? t.brew.noteTabWrite : t.brew.noteTabPreview}
              </button>
            ))}
          </div>
        </div>

        <div className="brew-note__meta">
          <label className="brew-note__field">
            <span>{t.brew.noteTopic}</span>
            <select
              value={topic ?? ''}
              onChange={(e) => setTopic(e.target.value || null)}
              aria-label={t.brew.noteTopic}
            >
              <option value="">{t.brew.noteTopicNone}</option>
              {topicChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {t.brew[choice.nameKey]}
                </option>
              ))}
              {topic && !topicChoices.some((choice) => choice.key === topic) ? (
                <option value={topic}>{topic}</option>
              ) : null}
            </select>
          </label>
          <label className="brew-note__field">
            <span>{t.brew.notePublishedAt}</span>
            <input
              type="datetime-local"
              value={toDatetimeLocal(publishedAt ?? 0)}
              onChange={(e) => setPublishedAt(fromDatetimeLocal(e.target.value))}
              aria-label={t.brew.notePublishedAt}
            />
          </label>
          <div className="brew-note__cover">
            <span className="brew-note__field-label">{t.brew.noteCover}</span>
            {coverPreview ? (
              <img
                src={coverPreview}
                alt=""
                className="brew-note__cover-thumb"
              />
            ) : null}
            {cover ? null : (
              <span className="brew-note__cover-hint">{t.brew.noteCoverAuto}</span>
            )}
            <button
              type="button"
              onClick={() => coverFileRef.current?.click()}
              disabled={uploading}
              className="brew-note__pane"
            >
              {t.brew.noteCoverPick}
            </button>
            {cover ? (
              <button
                type="button"
                onClick={() => setCover(null)}
                className="brew-note__pane"
              >
                {t.brew.noteCoverClear}
              </button>
            ) : null}
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
          </div>
        </div>

        {error ? <div className="brew-note__alert">{error}</div> : null}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="brew-note__body">
            <div
              className={`brew-note__write${pane === 'write' ? '' : ' is-hidden'}`}
            >
              <textarea
                ref={textareaRef}
                value={contentMd}
                onChange={(e) => setContentMd(e.target.value)}
                placeholder={t.brew.noteBodyPlaceholder}
                aria-label={t.brew.noteBodyPlaceholder}
                spellCheck={false}
              />
            </div>
            <div
              className={`brew-note__read${pane === 'preview' ? '' : ' is-hidden'}`}
            >
              {previewing && !html ? (
                <div className="flex justify-center py-8">
                  <Spinner size="md" />
                </div>
              ) : html ? (
                <div
                  className="brew-note-preview"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <p className="brew-note__empty">{t.brew.notePreviewEmpty}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>,
    document.body,
  )
}
