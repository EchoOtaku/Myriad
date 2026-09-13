/**
 * 写作器的外壳：薄顶栏、标题下的一行元信息、选区浮动条、底栏、发布抽屉。
 * 控件全是 NoteControls 里自己的，不借设置页；这里不碰 brewApi。
 */

import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react'
import type { TopicNameKey } from '../logic/topics'
import type { NoteCollabPeer } from './noteCollab'
import type { SelectionAnchor, VisualBlockKind } from './noteSelection'

import {
  LuEye as Eye,
  LuImage as Image,
  LuPlus as Plus,
  LuSlidersHorizontal as SlidersHorizontal,
  LuTrash2 as Trash2,
  LuUnlink as Unlink,
  LuX as X,
} from '@lib/icons'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { noteEditorStatus } from './noteBoard'
import {
  NoteButton,
  NoteDateInput,
  NoteField,
  NoteSelect,
  NoteSwitch,
} from './NoteControls'
import { placeBubble, placeGutter } from './noteSelection'

export type NoteEditorPane = 'write' | 'visual' | 'preview'
export type NoteEditorDocStatus = 'draft' | 'scheduled' | 'published'

export interface NoteEditorTool {
  key: string
  icon: ReactNode
  label: string
  run: () => void
}

/** 选中文字才用得上的放浮动条，其余是块级插入。 */
const MARK_TOOL_KEYS = ['bold', 'italic', 'strike', 'inline-code', 'link', 'h2', 'h3', 'quote']

export function splitNoteTools(tools: NoteEditorTool[]): {
  marks: NoteEditorTool[]
  inserts: NoteEditorTool[]
} {
  const marks = MARK_TOOL_KEYS.flatMap((key) =>
    tools.filter((tool) => tool.key === key),
  )
  const inserts = tools.filter((tool) => !MARK_TOOL_KEYS.includes(tool.key))
  return { marks, inserts }
}

export function peerInitial(peer: NoteCollabPeer): string {
  const name = peer.name?.trim()
  return name ? [...name][0]!.toUpperCase() : '·'
}

/** 协作者各领一个固定色，不跟壁纸走。 */
const PEER_HUES = [14, 152, 210, 268, 328, 44]

export function peerHue(peerId: string): number {
  let hash = 0
  for (const ch of peerId) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return PEER_HUES[hash % PEER_HUES.length]!
}

/* ------------------------------------------------------------------ */

export interface NoteTopBarProps {
  docStatus: NoteEditorDocStatus
  lastError: string | null
  scheduledAt: number | null
  cloudHint: boolean
  peers: NoteCollabPeer[]
  pane: NoteEditorPane
  onTogglePreview: () => void
  saving: boolean
  loading: boolean
  onPublish: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
  onClose: () => void
  error: string | null
}

export function NoteTopBar({
  docStatus,
  lastError,
  scheduledAt,
  cloudHint,
  peers,
  pane,
  onTogglePreview,
  saving,
  loading,
  onPublish,
  settingsOpen,
  onToggleSettings,
  onClose,
  error,
}: NoteTopBarProps) {
  const { t, format, locale } = useI18n()
  const statusLabel = noteEditorStatus(
    { lastError, status: docStatus, scheduledAt, savedHint: cloudHint },
    {
      failed: t.brew.noteScheduleFailed,
      scheduled: t.brew.noteStatusScheduled,
      published: t.brew.noteStatusPublished,
      draft: t.brew.noteStatusDraft,
      saved: t.brew.noteDraftSaved,
    },
    locale,
  )
  return (
    <header className="brew-note__top">
      <div className="brew-note__top-row">
        <div className="brew-note__top-left">
          <NoteButton
            variant="quiet"
            icon={<X />}
            onClick={onClose}
            title={t.brew.close}
            aria-label={t.brew.close}
          />
          <span
            className={`brew-note__state${lastError ? ' is-failed' : ''}`}
            role="status"
          >
            {statusLabel}
          </span>
          {peers.length ? (
            <div className="brew-note__peers">
              {peers.map((peer) => (
                <span
                  key={peer.peerId}
                  className="brew-note__peer"
                  style={{ '--peer-hue': peerHue(peer.peerId) } as CSSProperties}
                  title={
                    peer.name
                      ? format(t.brew.noteCollabNamed, { name: peer.name })
                      : format(t.brew.noteCollabHere, { count: 1 })
                  }
                >
                  {peerInitial(peer)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="brew-note__top-right">
          <NoteButton
            variant="quiet"
            icon={<Eye />}
            active={pane === 'preview'}
            aria-pressed={pane === 'preview'}
            onClick={onTogglePreview}
          >
            {t.brew.noteTabPreview}
          </NoteButton>
          <NoteButton
            variant="solid"
            size="lg"
            loading={saving}
            disabled={loading}
            onClick={onPublish}
          >
            {t.brew.notePublish}
          </NoteButton>
          <NoteButton
            variant="quiet"
            icon={<SlidersHorizontal />}
            active={settingsOpen}
            aria-pressed={settingsOpen}
            aria-expanded={settingsOpen}
            aria-label={t.brew.notePublishSettings}
            title={t.brew.notePublishSettings}
            onClick={onToggleSettings}
          />
        </div>
      </div>
      {error ? (
        <p className="brew-note__alert" role="alert">
          {error}
        </p>
      ) : null}
    </header>
  )
}

/* ------------------------------------------------------------------ */

export interface NoteBylineProps {
  topic: string | null
  topicChoices: { key: string; nameKey: TopicNameKey }[]
  publishedAt: number | null
  scheduledAt: number | null
  docStatus: NoteEditorDocStatus
  onOpenSettings: () => void
}

/** 标题下面一行淡字：主题 · 时间。点开发布设置。 */
export function NoteByline({
  topic,
  topicChoices,
  publishedAt,
  scheduledAt,
  docStatus,
  onOpenSettings,
}: NoteBylineProps) {
  const { t, locale } = useI18n()
  const topicLabel = useMemo(() => {
    if (!topic) return t.brew.noteTopicNone
    const choice = topicChoices.find((item) => item.key === topic)
    return choice ? t.brew[choice.nameKey] : topic
  }, [t.brew, topic, topicChoices])
  const when = docStatus === 'scheduled' ? scheduledAt : publishedAt
  const whenLabel =
    when != null && Number.isFinite(when)
      ? new Date(when).toLocaleString(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null
  return (
    <button
      type="button"
      className="brew-note__byline"
      onClick={onOpenSettings}
      title={t.brew.notePublishSettings}
    >
      <span>{topicLabel}</span>
      {whenLabel ? (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {docStatus === 'scheduled' ? `${t.brew.noteStatusScheduled} ` : ''}
            {whenLabel}
          </span>
        </>
      ) : null}
    </button>
  )
}

/* ------------------------------------------------------------------ */

export interface NoteBubbleProps {
  anchor: SelectionAnchor | null
  tools: NoteEditorTool[]
  containerRef: RefObject<HTMLElement | null>
  /** 链接地址栏打开时，浮动条改成一行输入框。 */
  linkOpen: boolean
  linkInitial: string
  onLinkOpenChange: (open: boolean) => void
  /** `null` 表示移除链接。 */
  onLink: (url: string | null) => void
}

/** 选中文字才出现，压在选区上方。深底白字，和 Medium 一样不抢正文。 */
export function NoteBubble({
  anchor,
  tools,
  containerRef,
  linkOpen,
  linkInitial,
  onLinkOpenChange,
  onLink,
}: NoteBubbleProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(
    null,
  )
  const [url, setUrl] = useState('')

  useLayoutEffect(() => {
    const bubble = ref.current
    const container = containerRef.current
    if (!anchor || !bubble || !container) {
      setPlacement(null)
      return
    }
    setPlacement(
      placeBubble(
        anchor,
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        { width: container.clientWidth, scrollTop: container.scrollTop },
      ),
    )
  }, [anchor, containerRef, linkOpen])

  useEffect(() => {
    if (!linkOpen) return
    setUrl(linkInitial)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [linkOpen, linkInitial])

  if (!anchor || tools.length === 0) return null
  return (
    <div
      ref={ref}
      className={`brew-note__bubble${placement ? ' is-placed' : ''}${linkOpen ? ' is-link' : ''}`}
      style={
        placement
          ? { top: `${placement.top}px`, left: `${placement.left}px` }
          : undefined
      }
      role="toolbar"
    >
      {linkOpen ? (
        <form
          className="brew-note__bubble-link"
          onSubmit={(event) => {
            event.preventDefault()
            const value = url.trim()
            onLink(value || null)
          }}
        >
          <input
            ref={inputRef}
            className="brew-note__bubble-input"
            type="url"
            inputMode="url"
            value={url}
            placeholder={t.brew.noteLinkPlaceholder}
            aria-label={t.brew.noteToolLink}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onLinkOpenChange(false)
              }
            }}
          />
          {linkInitial ? (
            <button
              type="button"
              className="brew-note__bubble-btn"
              title={t.brew.noteLinkRemove}
              aria-label={t.brew.noteLinkRemove}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onLink(null)}
            >
              <Unlink />
            </button>
          ) : null}
        </form>
      ) : (
        tools.map((tool) =>
          tool.key === 'link' ? (
            <button
              key={tool.key}
              type="button"
              className="brew-note__bubble-btn"
              title={tool.label}
              aria-label={tool.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onLinkOpenChange(true)}
            >
              {tool.icon}
            </button>
          ) : (
            <button
              key={tool.key}
              type="button"
              className={`brew-note__bubble-btn${/^h\d$/.test(tool.key) ? ' brew-note__bubble-btn--text' : ''}`}
              title={tool.label}
              aria-label={tool.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={tool.run}
            >
              {tool.icon}
            </button>
          ),
        )
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

export interface NoteBlockBarProps {
  block: { kind: VisualBlockKind; anchor: SelectionAnchor } | null
  codeLang: string
  onCodeLangChange: (lang: string) => void
  onTableAddRow: () => void
  onTableAddColumn: () => void
  onTableRemove: () => void
  onFocusChange: (focused: boolean) => void
}

/** 光标在表格 / 代码块里时，块右上角的一小条：加行加列删表，或者填代码语言。 */
export function NoteBlockBar({
  block,
  codeLang,
  onCodeLangChange,
  onTableAddRow,
  onTableAddColumn,
  onTableRemove,
  onFocusChange,
}: NoteBlockBarProps) {
  const { t } = useI18n()
  if (!block) return null
  const { anchor, kind } = block
  return (
    <div
      className="brew-note__blockbar"
      style={{
        top: `${anchor.top - 8}px`,
        left: `${anchor.left + anchor.width}px`,
      }}
      role="toolbar"
    >
      {kind === 'table' ? (
        <>
          <button
            type="button"
            className="brew-note__blockbar-btn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onTableAddRow}
          >
            {t.brew.noteTableAddRow}
          </button>
          <button
            type="button"
            className="brew-note__blockbar-btn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onTableAddColumn}
          >
            {t.brew.noteTableAddColumn}
          </button>
          <button
            type="button"
            className="brew-note__blockbar-btn is-danger"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onTableRemove}
          >
            {t.brew.noteTableRemove}
          </button>
        </>
      ) : (
        <label className="brew-note__blockbar-field">
          <span>{t.brew.noteCodeLang}</span>
          <input
            className="brew-note__blockbar-input"
            value={codeLang}
            placeholder="rust"
            spellCheck={false}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            onChange={(event) => onCodeLangChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                ;(event.currentTarget as HTMLInputElement).blur()
              }
            }}
          />
        </label>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

export type NoteInsertMenuState = null | 'pointer' | 'keys'

export interface NoteGutterProps {
  /** 光标停在空行时的位置；null 就不画。 */
  emptyLine: SelectionAnchor | null
  menu: NoteInsertMenuState
  onMenuChange: (menu: NoteInsertMenuState) => void
  items: NoteEditorTool[]
  busy: boolean
}

const GUTTER_SIZE = 36

/**
 * 行槛「+」：跟着空行的光标浮在左边，点开是块级插入菜单。
 * `/` 在空行上也打开同一份菜单，那时焦点在菜单里，方向键选、回车用。
 */
export function NoteGutter({
  emptyLine,
  menu,
  onMenuChange,
  items,
  busy,
}: NoteGutterProps) {
  const { t } = useI18n()
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = menu != null

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onMenuChange(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onMenuChange])

  useEffect(() => {
    if (menu !== 'keys') return
    menuRef.current
      ?.querySelector<HTMLButtonElement>('.brew-note__menu-item')
      ?.focus()
  }, [menu])

  if (!emptyLine) return null
  const placed = placeGutter(emptyLine, GUTTER_SIZE)

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '.brew-note__menu-item',
      ) ?? []),
    ]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const go = (next: number) => {
      event.preventDefault()
      buttons[(next + buttons.length) % buttons.length]?.focus()
    }
    if (event.key === 'ArrowDown') go(index + 1)
    else if (event.key === 'ArrowUp') go(index - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(buttons.length - 1)
  }

  return (
    <div
      ref={wrapRef}
      className="brew-note__gutter"
      style={{ top: `${placed.top}px`, left: `${placed.left}px` }}
    >
      <button
        type="button"
        className={`brew-note__plus${open ? ' is-open' : ''}`}
        aria-label={t.brew.noteInsert}
        title={t.brew.noteInsert}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onMenuChange(open ? null : 'pointer')}
      >
        <Plus />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="brew-note__menu"
          role="menu"
          aria-label={t.brew.noteInsert}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((tool) => (
            <button
              key={tool.key}
              type="button"
              role="menuitem"
              className="brew-note__menu-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onMenuChange(null)
                tool.run()
              }}
            >
              <span className="brew-note__menu-icon">{tool.icon}</span>
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

export interface NoteFootBarProps {
  chars: number
  pane: NoteEditorPane
  onPaneChange: (pane: 'write' | 'visual') => void
}

/** 底栏只是状态栏：字数 + 写/可视。 */
export function NoteFootBar({ chars, pane, onPaneChange }: NoteFootBarProps) {
  const { t, format } = useI18n()
  return (
    <footer className="brew-note__foot">
      <span className="brew-note__count">
        {format(t.brew.noteCharCount, { count: chars })}
      </span>
      <div className="brew-note__foot-right">
        <NoteSwitch<'write' | 'visual'>
          className="brew-note__modes"
          ariaLabel={t.brew.noteTabWrite}
          value={pane === 'preview' ? null : pane}
          onChange={onPaneChange}
          options={[
            { value: 'write', label: t.brew.noteTabWrite },
            { value: 'visual', label: t.brew.noteTabVisual },
          ]}
        />
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ */

export interface NoteSettingsDrawerProps {
  open: boolean
  onClose: () => void
  docStatus: NoteEditorDocStatus
  topic: string | null
  topicChoices: { key: string; nameKey: TopicNameKey }[]
  onTopicChange: (topic: string | null) => void
  publishedAt: number | null
  onPublishedAtChange: (ms: number | null) => void
  scheduledAt: number | null
  onScheduledAtChange: (ms: number | null) => void
  canSchedule: boolean
  busy: boolean
  onSchedule: () => void
  onUnschedule: () => void
  cover: string | null
  coverPreview: string | null
  uploading: boolean
  onPickCover: () => void
  onClearCover: () => void
  canDelete: boolean
  onDelete: () => void
}

/** 主题 / 时间 / 封面 / 定时 / 删除。写作时收起来。 */
export function NoteSettingsDrawer({
  open,
  onClose,
  docStatus,
  topic,
  topicChoices,
  onTopicChange,
  publishedAt,
  onPublishedAtChange,
  scheduledAt,
  onScheduledAtChange,
  canSchedule,
  busy,
  onSchedule,
  onUnschedule,
  cover,
  coverPreview,
  uploading,
  onPickCover,
  onClearCover,
  canDelete,
  onDelete,
}: NoteSettingsDrawerProps) {
  const { t } = useI18n()
  const topicOptions = useMemo(() => {
    const choices = topicChoices.map((choice) => ({
      value: choice.key,
      label: t.brew[choice.nameKey],
    }))
    if (topic && !choices.some((choice) => choice.value === topic)) {
      choices.push({ value: topic, label: topic })
    }
    return [{ value: '', label: t.brew.noteTopicNone }, ...choices]
  }, [t.brew, topic, topicChoices])

  if (!open) return null
  return (
    <aside className="brew-note__drawer" aria-label={t.brew.notePublishSettings}>
      <div className="brew-note__drawer-head">
        <h2 className="brew-note__drawer-title">{t.brew.notePublishSettings}</h2>
        <NoteButton
          variant="quiet"
          icon={<X />}
          onClick={onClose}
          aria-label={t.brew.close}
          title={t.brew.close}
        />
      </div>

      <NoteField label={t.brew.noteTopic} htmlFor="note-topic">
        <NoteSelect
          id="note-topic"
          value={topic ?? ''}
          options={topicOptions}
          onChange={(value) => onTopicChange(value || null)}
        />
      </NoteField>

      <NoteField label={t.brew.notePublishedAt} htmlFor="note-published-at">
        <NoteDateInput
          id="note-published-at"
          value={publishedAt}
          onChange={onPublishedAtChange}
        />
      </NoteField>

      {docStatus === 'published' ? null : (
        <NoteField label={t.brew.noteScheduledAt} htmlFor="note-scheduled-at">
          <NoteDateInput
            id="note-scheduled-at"
            value={scheduledAt}
            onChange={onScheduledAtChange}
          />
          <div className="brew-note__drawer-actions">
            {docStatus === 'scheduled' ? (
              <NoteButton variant="outline" disabled={busy} onClick={onUnschedule}>
                {t.brew.noteUnschedule}
              </NoteButton>
            ) : (
              <NoteButton
                variant="outline"
                disabled={busy || !canSchedule}
                onClick={onSchedule}
              >
                {t.brew.noteSchedule}
              </NoteButton>
            )}
          </div>
        </NoteField>
      )}

      <NoteField
        label={t.brew.noteCover}
        hint={cover ? undefined : t.brew.noteCoverAuto}
      >
        <div className="brew-note__cover">
          {coverPreview ? (
            <img src={coverPreview} alt="" className="brew-note__cover-thumb" />
          ) : (
            <span className="brew-note__cover-thumb brew-note__cover-thumb--empty">
              <Image />
            </span>
          )}
          <div className="brew-note__drawer-actions">
            <NoteButton
              variant="outline"
              loading={uploading}
              onClick={onPickCover}
            >
              {t.brew.noteCoverPick}
            </NoteButton>
            {cover ? (
              <NoteButton variant="quiet" onClick={onClearCover}>
                {t.brew.noteCoverClear}
              </NoteButton>
            ) : null}
          </div>
        </div>
      </NoteField>

      {canDelete ? (
        <div className="brew-note__drawer-foot">
          <NoteButton
            variant="danger"
            icon={<Trash2 />}
            disabled={busy}
            onClick={onDelete}
          >
            {t.brew.noteDelete}
          </NoteButton>
        </div>
      ) : null}
    </aside>
  )
}
