/** 管理员工作台皮。不进口 brewApi / manager。侧栏一页一项，分类标题用 SettingSection。 */

import type { ReactElement, ReactNode } from 'react'
import type { MediaAsset } from '../../../services/mediaApi'
import type { BrewNoteDoc } from '../../../types/brew'
import type {
  ManagedListItem,
  ManagedListTone,
} from '../../settings/ManagedList'
import type {
  NoteTransferKind,
  SourceSortMode,
  WorkbenchPane,
} from '../logic/board'
import type {
  WorkbenchMediaFormatFilter,
  WorkbenchMediaKindFilter,
  WorkbenchNoteStatusFilter,
  WorkbenchNoteStatusKey,
} from '../logic/workbench'
import {
  HaloIcon,
  LuChevronLeft,
  LuChevronRight,
  LuClipboardList,
  LuDownload,
  LuFileText,
  LuFolderOpen,
  LuGauge,
  LuImage,
  LuList,
  LuNotebookPen,
  LuPackage,
  LuPlus,
  LuRefreshCw,
  LuRss,
  LuServer,
  LuSquare,
  LuTag,
  LuUpload,
  SiMarkdown,
  SiWordpress,
  TypechoIcon,
} from '@lib/icons'
import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import {
  CheckboxCard,
  InputItem,
  ManagedList,
  SegmentedControl,
  SettingsButton,
  SettingSection,
} from '../../settings'
import { SettingItemWrapper } from '../../settings/items/SettingItemWrapper'
import { getImageUrl } from '../constants'
import { readSourceSortMode, writeSourceSortMode } from '../logic/sourceSort'
import {
  collectWorkbenchMediaFormats,
  collectWorkbenchNoteTopics,
  filterWorkbenchMedia,
  filterWorkbenchNotes,
  formatWorkbenchBytes,
  workbenchMediaFormatKey,
  workbenchMediaFormatLabel,
  workbenchMediaRefLabel,
  workbenchNoteCover,
  workbenchNoteExcerpt,
  workbenchNoteOpen,
  workbenchNoteStatusKey,
  workbenchNoteWhen,
} from '../logic/workbench'
import { noteScheduleLabel } from '../notes/noteBoard'
import { displayImageUrl } from '../notes/noteImageUrl'
import '../../ConfigForm.css'
import '../ui/css/workbench.css'

const SORTS: Array<{
  id: SourceSortMode
  label: 'sortBySmart' | 'sortByUpdate' | 'sortByCategory' | 'sortByPinyin'
}> = [
  { id: 'smart', label: 'sortBySmart' },
  { id: 'update', label: 'sortByUpdate' },
  { id: 'category', label: 'sortByCategory' },
  { id: 'pinyin', label: 'sortByPinyin' },
]

const RAIL: Array<{
  pane: WorkbenchPane
  label:
    | 'workbenchOverview'
    | 'workbenchNotes'
    | 'workbenchMedia'
    | 'workbenchSources'
    | 'workbenchRsshub'
    | 'workbenchNavTransfer'
  icon: ReactNode
  pack: 'content' | 'feeds'
}> = [
  {
    pane: 'home',
    label: 'workbenchOverview',
    icon: <LuGauge />,
    pack: 'content',
  },
  {
    pane: 'notes',
    label: 'workbenchNotes',
    icon: <LuNotebookPen />,
    pack: 'content',
  },
  {
    pane: 'media',
    label: 'workbenchMedia',
    icon: <LuImage />,
    pack: 'content',
  },
  {
    pane: 'notesIo',
    label: 'workbenchNavTransfer',
    icon: <LuUpload />,
    pack: 'content',
  },
  {
    pane: 'sources',
    label: 'workbenchSources',
    icon: <LuRss />,
    pack: 'feeds',
  },
  {
    pane: 'rsshub',
    label: 'workbenchRsshub',
    icon: <LuServer />,
    pack: 'feeds',
  },
  {
    pane: 'feedsIo',
    label: 'workbenchNavTransfer',
    icon: <LuPackage />,
    pack: 'feeds',
  },
]

const NOTE_TRANSFER_FORMATS: Array<{
  kind: NoteTransferKind
  title:
    | 'workbenchWordpress'
    | 'workbenchHalo'
    | 'workbenchTypecho'
    | 'workbenchMarkdown'
  hint:
    | 'workbenchWordpressHint'
    | 'workbenchHaloHint'
    | 'workbenchTypechoHint'
    | 'workbenchMarkdownHint'
  accept: string
  formats: string
  icon: ReactNode
}> = [
  {
    kind: 'wordpress',
    title: 'workbenchWordpress',
    hint: 'workbenchWordpressHint',
    accept: '.xml,.wxr,text/xml',
    formats: '.xml / .wxr',
    icon: <SiWordpress />,
  },
  {
    kind: 'halo',
    title: 'workbenchHalo',
    hint: 'workbenchHaloHint',
    accept: '.json,.zip,application/json,application/zip',
    formats: '.json / .zip',
    icon: <HaloIcon />,
  },
  {
    kind: 'typecho',
    title: 'workbenchTypecho',
    hint: 'workbenchTypechoHint',
    accept: '.xml,text/xml',
    formats: '.xml',
    icon: <TypechoIcon />,
  },
  {
    kind: 'markdown',
    title: 'workbenchMarkdown',
    hint: 'workbenchMarkdownHint',
    accept: '.zip,.md,text/markdown,application/zip',
    formats: '.zip / .md',
    icon: <SiMarkdown />,
  },
]

const RAIL_PACKS: Array<{
  id: 'content' | 'feeds'
  title: 'workbenchNavContent' | 'workbenchSources'
}> = [
  { id: 'content', title: 'workbenchNavContent' },
  { id: 'feeds', title: 'workbenchSources' },
]

function noteTone(
  key: WorkbenchNoteStatusKey,
  failed = false,
): ManagedListTone {
  if (failed) return 'danger'
  if (key === 'noteStatusScheduled') return 'warn'
  if (key === 'noteStatusPublished') return 'success'
  return 'muted'
}

function Thumb({
  src,
  video = false,
  cover = false,
}: {
  src?: string
  video?: boolean
  cover?: boolean
}) {
  const className = cover ? 'brew-workbench__cover' : 'brew-workbench__thumb'
  if (!src) return <span className={`${className} is-empty`} />
  if (video) {
    return (
      <video
        className={className}
        src={src}
        muted
        playsInline
        preload="metadata"
      />
    )
  }
  return <img className={className} src={src} alt="" />
}

function NavBtn({
  label,
  icon,
  current,
  onPick,
}: {
  label: string
  icon: ReactNode
  current: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`config-nav-item${current ? ' is-active' : ''}`}
      aria-current={current ? 'page' : undefined}
      onClick={onPick}
    >
      <span className="config-nav-item-icon" aria-hidden>
        {icon}
      </span>
      <span className="config-nav-item-label">{label}</span>
      <span className="config-nav-item-chevron" aria-hidden>
        <LuChevronRight size={16} />
      </span>
    </button>
  )
}

function WorkbenchPage({
  title,
  icon,
  description,
  action,
  search,
  back,
  children,
}: {
  title: string
  icon: ReactNode
  description?: string
  action?: ReactNode
  search?: ReactNode
  back: ReactNode
  children: ReactNode
}) {
  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      descriptionVisible={Boolean(description)}
      subtitle={search}
      headerLeading={back}
      headerActions={action ?? false}
      showResetPage={false}
      helpToggle={false}
      animated={false}
    >
      {children}
    </SettingSection>
  )
}

function TransferActions({
  accept,
  busy,
  canExport,
  progress,
  dropLabel,
  formatsLabel,
  startLabel,
  exportLabel,
  mark,
  onExport,
  onImport,
}: {
  accept: string
  busy: boolean
  canExport: boolean
  progress: string | null
  dropLabel: string
  formatsLabel: string
  startLabel: string
  exportLabel: string
  mark?: ReactNode
  onExport: () => void
  onImport: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [picked, setPicked] = useState<File | null>(null)

  const takeFile = (file: File | undefined) => {
    if (!file || busy) return
    setPicked(file)
  }

  return (
    <div className="brew-workbench__transfer">
      <button
        type="button"
        className={`brew-workbench__drop${dragOver ? ' is-on' : ''}`}
        disabled={busy}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          takeFile(event.dataTransfer.files[0])
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="brew-workbench__drop-file"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            takeFile(file)
          }}
        />
        {mark ?? <LuFolderOpen />}
        <p>{dropLabel}</p>
        <small>{picked ? picked.name : formatsLabel}</small>
      </button>
      <div className="brew-workbench__transfer-actions">
        {picked ? (
          <SettingsButton
            variant="primary"
            size="sm"
            block
            icon={<LuUpload />}
            disabled={busy}
            loading={busy}
            onClick={() => {
              const file = picked
              setPicked(null)
              onImport(file)
            }}
          >
            {startLabel}
          </SettingsButton>
        ) : null}
        <SettingsButton
          size="sm"
          block
          icon={<LuDownload />}
          disabled={busy || !canExport}
          loading={busy}
          onClick={onExport}
        >
          {exportLabel}
        </SettingsButton>
      </div>
      {progress ? <p className="setting-description">{progress}</p> : null}
    </div>
  )
}

function PageAction({
  label,
  description,
  icon,
  disabled,
  loading,
  onPick,
}: {
  label: string
  description?: string
  icon: ReactNode
  disabled?: boolean
  loading?: boolean
  onPick: () => void
}) {
  return (
    <CheckboxCard
      variant="action"
      tone="primary"
      label={label}
      description={description}
      icon={icon}
      showIndicator={false}
      checked={false}
      onChange={() => onPick()}
      disabled={disabled}
      loading={loading}
      className="setting-section-header-action"
    />
  )
}

function Kpi({
  value,
  label,
  tone,
  onPick,
}: {
  value: number
  label: string
  tone?: 'warn' | 'danger'
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`brew-workbench__kpi${tone ? ` is-${tone}` : ''}`}
      onClick={onPick}
    >
      <span className="brew-workbench__kpi-value">{value}</span>
      <span className="brew-workbench__kpi-label">{label}</span>
    </button>
  )
}

export default function BrewWorkbench({
  pane,
  onPane,
  docs,
  media,
  notesLoading,
  mediaLoading,
  busy,
  sourceCount,
  packBusy,
  packProgress,
  onWrite,
  onOpenNote,
  onDeleteNote,
  onUnschedule,
  onUpload,
  onDeleteMedia,
  onExportPack,
  onImportPack,
  notesBusy,
  notesKind,
  notesProgress,
  onExportNotes,
  onImportNotes,
  canRefreshSources,
  onRefreshSources,
  admin,
}: {
  pane: WorkbenchPane
  onPane: (pane: WorkbenchPane) => void
  docs: BrewNoteDoc[]
  media: MediaAsset[]
  notesLoading: boolean
  mediaLoading: boolean
  busy: boolean
  sourceCount: number
  packBusy: boolean
  packProgress: string | null
  onWrite: () => void
  onOpenNote: (open: ReturnType<typeof workbenchNoteOpen>) => void
  onDeleteNote: (doc: BrewNoteDoc) => void
  onUnschedule: (id: number) => void
  onUpload: (file: File) => void
  onDeleteMedia: (id: number) => void
  onExportPack: () => void
  onImportPack: (file: File) => void
  notesBusy: boolean
  notesKind: NoteTransferKind | null
  notesProgress: string | null
  onExportNotes: (kind: NoteTransferKind) => void
  onImportNotes: (kind: NoteTransferKind, file: File) => void
  canRefreshSources: boolean
  onRefreshSources: () => void | Promise<unknown>
  admin?: ReactNode
}) {
  const { t, locale, format } = useI18n()
  const brew = t.brew
  const fileRef = useRef<HTMLInputElement>(null)
  const [mobilePane, setMobilePane] = useState<'nav' | 'section'>('section')
  const [mediaKind, setMediaKind] = useState<WorkbenchMediaKindFilter>('all')
  const [mediaFormat, setMediaFormat] =
    useState<WorkbenchMediaFormatFilter>('all')
  const [mediaQuery, setMediaQuery] = useState('')
  const [mediaLayout, setMediaLayout] = useState<'list' | 'grid'>('grid')
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceRefreshing, setSourceRefreshing] = useState(false)

  useEffect(() => {
    if (pane !== 'sources') setSourceQuery('')
  }, [pane])

  const boundAdmin =
    (pane === 'sources' || pane === 'add') && isValidElement(admin)
      ? cloneElement(
          admin as ReactElement<{
            query?: string
            refreshingAll?: boolean
            onAdded?: () => void
          }>,
          {
            query: sourceQuery,
            refreshingAll: sourceRefreshing,
            onAdded: () => {
              onPane('sources')
              setMobilePane('section')
            },
          },
        )
      : admin
  const [noteQuery, setNoteQuery] = useState('')
  const [noteStatus, setNoteStatus] = useState<WorkbenchNoteStatusFilter>('all')
  const [noteTopic, setNoteTopic] = useState('all')
  const [sortMode, setSortMode] = useState<SourceSortMode>(readSourceSortMode)
  const mediaFormats = useMemo(
    () => collectWorkbenchMediaFormats(media),
    [media],
  )
  const mediaFormatOptions = useMemo(
    () => [
      { key: 'all', label: brew.workbenchMediaAll },
      ...mediaFormats.map((key) => ({
        key,
        label: workbenchMediaFormatLabel(key, brew.workbenchMediaFormatOther),
      })),
    ],
    [brew.workbenchMediaAll, brew.workbenchMediaFormatOther, mediaFormats],
  )
  const resolvedMediaFormat = mediaFormatOptions.some(
    (opt) => opt.key === mediaFormat,
  )
    ? mediaFormat
    : 'all'
  const visibleMedia = useMemo(
    () =>
      filterWorkbenchMedia(media, {
        kind: mediaKind,
        format: resolvedMediaFormat,
        query: mediaQuery,
      }),
    [media, mediaKind, mediaQuery, resolvedMediaFormat],
  )
  const noteTopics = useMemo(() => collectWorkbenchNoteTopics(docs), [docs])
  const noteTopicOptions = useMemo(
    () => [
      { key: 'all', label: brew.noteCategoryAll },
      ...noteTopics.map((name) => ({ key: name, label: name })),
    ],
    [brew.noteCategoryAll, noteTopics],
  )
  const resolvedNoteTopic = noteTopicOptions.some(
    (opt) => opt.key === noteTopic,
  )
    ? noteTopic
    : 'all'
  const visibleNotes = useMemo(
    () =>
      filterWorkbenchNotes(docs, {
        status: noteStatus,
        query: noteQuery,
        topic: resolvedNoteTopic === 'all' ? null : resolvedNoteTopic,
      }),
    [docs, noteQuery, noteStatus, resolvedNoteTopic],
  )
  const scheduledCount = docs.filter((doc) => doc.status === 'scheduled').length
  const failedCount = docs.filter((doc) => doc.last_error).length

  const open = (next: WorkbenchPane) => {
    onPane(next)
    setMobilePane('section')
  }

  const back = (
    <button
      type="button"
      className="section-header-back"
      onClick={() => setMobilePane('nav')}
      aria-label={t.nav.backToNav}
    >
      <LuChevronLeft size={18} aria-hidden />
      <span>{t.common.back}</span>
    </button>
  )

  const backToSources = (
    <button
      type="button"
      className="section-header-back brew-workbench__parent-back"
      onClick={() => open('sources')}
      aria-label={brew.workbenchSources}
    >
      <LuChevronLeft size={18} aria-hidden />
      <span>{t.common.back}</span>
    </button>
  )

  const noteItems = useMemo<ManagedListItem[]>(
    () =>
      visibleNotes.map((doc) => {
        const statusKey = workbenchNoteStatusKey(doc)
        const when = noteScheduleLabel(workbenchNoteWhen(doc), locale)
        const excerpt = workbenchNoteExcerpt(doc.content_md)
        const facts = [doc.topic, when].filter(Boolean).join(' · ')
        return {
          id: doc.id,
          title: doc.title.trim() || brew.workbenchNoteUntitled,
          subtitle: excerpt || facts || undefined,
          meta: excerpt && facts ? facts : undefined,
          badge: {
            label: brew[statusKey],
            tone: noteTone(statusKey, Boolean(doc.last_error)),
          },
          className: 'brew-workbench__note brew-workbench__hover-actions',
          leading: (
            <Thumb
              cover
              src={getImageUrl(workbenchNoteCover(doc)) || undefined}
            />
          ),
          renderHit: ({ leading, main }) => (
            <button
              type="button"
              className="managed-list-row-hit"
              disabled={busy}
              onClick={() => onOpenNote(workbenchNoteOpen(doc))}
            >
              {leading}
              {main}
            </button>
          ),
          actions: [
            ...(doc.status === 'scheduled'
              ? [
                  {
                    key: 'unschedule',
                    label: brew.workbenchUnschedule,
                    onClick: () => onUnschedule(doc.id),
                    disabled: busy,
                  },
                ]
              : []),
            {
              key: 'delete',
              label: brew.delete,
              variant: 'danger' as const,
              confirm: brew.workbenchDeleteConfirm,
              onClick: () => onDeleteNote(doc),
              disabled: busy,
            },
          ],
        }
      }),
    [busy, brew, locale, onDeleteNote, onOpenNote, onUnschedule, visibleNotes],
  )

  const mediaItems = useMemo<ManagedListItem[]>(
    () =>
      visibleMedia.map((item) => {
        const src = displayImageUrl(item.url)
        const inUse = item.references.length > 0
        const refs = workbenchMediaRefLabel(item.references, {
          notes: brew.workbenchNotes,
          articles: brew.articles,
          site: brew.workbenchMediaRefSite,
        })
        const formatKey = workbenchMediaFormatKey(item)
        const format = workbenchMediaFormatLabel(
          formatKey,
          brew.workbenchMediaFormatOther,
        )
        const size = formatWorkbenchBytes(item.size)
        const when = noteScheduleLabel(item.created_at, locale)
        const kind =
          item.kind === 'generated'
            ? brew.workbenchMediaGeneratedKind
            : brew.workbenchMediaUploadKind
        const video = item.mime.startsWith('video/')
        return {
          id: item.id,
          title: item.name,
          subtitle: [size, when].filter(Boolean).join(' · '),
          meta: inUse
            ? refs || brew.workbenchMediaInUse
            : brew.workbenchMediaUnused,
          badges: [
            { label: format, tone: video ? 'warn' : 'muted' },
            {
              label: kind,
              tone: item.kind === 'generated' ? 'active' : 'muted',
            },
          ],
          className: 'brew-workbench__hover-actions brew-workbench__media',
          leading: <Thumb src={src} video={video} />,
          actions: [
            {
              key: 'delete',
              label: brew.delete,
              variant: 'danger' as const,
              confirm: brew.workbenchDeleteMediaConfirm,
              onClick: () => onDeleteMedia(item.id),
              disabled: busy || inUse,
              title: inUse ? refs || brew.workbenchMediaInUse : undefined,
            },
          ],
        }
      }),
    [brew, busy, locale, onDeleteMedia, visibleMedia],
  )

  return (
    <div
      className="brew-workbench"
      data-brew-surface="workbench"
      data-mobile-pane={mobilePane}
    >
      <aside className="config-sidebar brew-workbench__rail">
        <div className="config-sidebar-header">
          <span className="nav-icon" aria-hidden>
            <LuGauge />
          </span>
          <div className="config-sidebar-heading">
            <h3 className="nav-title">{brew.boardWorkbench}</h3>
            <p className="nav-subtitle">{brew.boardWorkbenchTitle}</p>
          </div>
        </div>
        <nav className="config-sidebar-scroll" aria-label={brew.boardWorkbench}>
          {RAIL_PACKS.map((pack) => (
            <div key={pack.id} className="config-nav-group">
              <div className="config-nav-group-title">{brew[pack.title]}</div>
              {RAIL.filter((item) => item.pack === pack.id).map((item) => (
                <NavBtn
                  key={item.pane}
                  label={brew[item.label]}
                  icon={item.icon}
                  current={
                    pane === item.pane ||
                    (pane === 'add' && item.pane === 'sources')
                  }
                  onPick={() => open(item.pane)}
                />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="brew-workbench__main">
        {pane === 'home' ? (
          <WorkbenchPage
            title={brew.workbenchOverview}
            icon={<LuGauge />}
            description={brew.boardWorkbenchTitle}
            back={back}
            action={
              <PageAction
                label={brew.noteWrite}
                description={brew.boardNotesTitle}
                icon={<LuNotebookPen />}
                disabled={busy}
                onPick={onWrite}
              />
            }
          >
            <section
              className="brew-workbench__kpis"
              aria-label={brew.workbenchOverview}
            >
              <Kpi
                value={docs.length}
                label={brew.workbenchNotes}
                onPick={() => open('notes')}
              />
              <Kpi
                value={scheduledCount}
                label={brew.noteStatusScheduled}
                tone={scheduledCount > 0 ? 'warn' : undefined}
                onPick={() => open('notes')}
              />
              <Kpi
                value={failedCount}
                label={brew.noteScheduleFailed}
                tone={failedCount > 0 ? 'danger' : undefined}
                onPick={() => open('notes')}
              />
              <Kpi
                value={media.length}
                label={brew.workbenchMedia}
                onPick={() => open('media')}
              />
              <Kpi
                value={sourceCount}
                label={brew.workbenchSources}
                onPick={() => open('sources')}
              />
            </section>
          </WorkbenchPage>
        ) : null}

        {pane === 'notes' ? (
          <WorkbenchPage
            title={brew.workbenchNotes}
            icon={<LuNotebookPen />}
            back={back}
            search={
              <InputItem
                itemKey="workbench-note-search"
                label={brew.workbenchSearchNotes}
                value={noteQuery}
                onChange={setNoteQuery}
                placeholder={brew.workbenchSearchNotes}
                inputType="search"
                size="sm"
                layout="vertical"
                autoComplete="off"
                className="brew-workbench__title-search"
              />
            }
            action={
              <PageAction
                label={brew.noteWrite}
                description={brew.boardNotesTitle}
                icon={<LuNotebookPen />}
                disabled={busy}
                onPick={onWrite}
              />
            }
          >
            <ManagedList
              filterGroups={[
                {
                  label: brew.workbenchNoteStatus,
                  icon: <LuClipboardList />,
                  ariaLabel: brew.workbenchNoteStatus,
                  options: [
                    { key: 'all', label: brew.workbenchMediaAll },
                    { key: 'draft', label: brew.noteStatusDraft },
                    { key: 'scheduled', label: brew.noteStatusScheduled },
                    { key: 'published', label: brew.noteStatusPublished },
                  ],
                  value: noteStatus,
                  onChange: (key) =>
                    setNoteStatus(key as WorkbenchNoteStatusFilter),
                },
                {
                  label: brew.noteTopic,
                  icon: <LuTag />,
                  ariaLabel: brew.noteTopic,
                  options: noteTopicOptions,
                  value: resolvedNoteTopic,
                  onChange: setNoteTopic,
                },
              ]}
              queryCollapsible={false}
              queryChrome="plain"
              loading={notesLoading && docs.length === 0}
              working={busy}
              items={noteItems}
              emptyText={
                docs.length === 0
                  ? brew.workbenchNoteEmpty
                  : brew.workbenchNoteKindEmpty
              }
              maxHeight={null}
            />
          </WorkbenchPage>
        ) : null}

        {pane === 'media' ? (
          <WorkbenchPage
            title={brew.workbenchMedia}
            icon={<LuImage />}
            back={back}
            search={
              <InputItem
                itemKey="workbench-media-search"
                label={brew.workbenchSearchMedia}
                value={mediaQuery}
                onChange={setMediaQuery}
                placeholder={brew.workbenchSearchMedia}
                inputType="search"
                size="sm"
                layout="vertical"
                autoComplete="off"
                className="brew-workbench__title-search"
              />
            }
            action={
              <PageAction
                label={brew.workbenchUpload}
                description={brew.workbenchMedia}
                icon={<LuImage />}
                disabled={busy}
                onPick={() => fileRef.current?.click()}
              />
            }
          >
            <ManagedList
              layout={mediaLayout}
              filterGroups={[
                {
                  label: brew.workbenchMediaFormat,
                  icon: <LuFileText />,
                  ariaLabel: brew.workbenchMediaFormat,
                  options: mediaFormatOptions,
                  value: resolvedMediaFormat,
                  onChange: (key) =>
                    setMediaFormat(key as WorkbenchMediaFormatFilter),
                },
                {
                  label: brew.workbenchMediaSource,
                  icon: <LuUpload />,
                  ariaLabel: brew.workbenchMediaSource,
                  options: [
                    { key: 'all', label: brew.workbenchMediaAll },
                    { key: 'upload', label: brew.workbenchMediaUploadKind },
                    {
                      key: 'generated',
                      label: brew.workbenchMediaGeneratedKind,
                    },
                  ],
                  value: mediaKind,
                  onChange: (key) =>
                    setMediaKind(key as WorkbenchMediaKindFilter),
                },
                {
                  label: brew.workbenchMediaLayout,
                  icon: <LuSquare />,
                  ariaLabel: brew.workbenchMediaLayout,
                  options: [
                    {
                      key: 'list',
                      label: brew.workbenchMediaLayoutList,
                      icon: <LuList />,
                    },
                    {
                      key: 'grid',
                      label: brew.workbenchMediaLayoutGrid,
                      icon: <LuSquare />,
                    },
                  ],
                  value: mediaLayout,
                  onChange: (key) =>
                    setMediaLayout(key === 'list' ? 'list' : 'grid'),
                },
              ]}
              queryCollapsible={false}
              queryChrome="plain"
              loading={mediaLoading && media.length === 0}
              working={busy}
              items={mediaItems}
              emptyText={
                media.length === 0
                  ? brew.workbenchMediaEmpty
                  : brew.workbenchMediaKindEmpty
              }
              maxHeight={null}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onUpload(file)
              }}
            />
          </WorkbenchPage>
        ) : null}

        {pane === 'sources' ? (
          <WorkbenchPage
            title={brew.workbenchSources}
            icon={<LuRss />}
            back={back}
            search={
              <InputItem
                itemKey="workbench-source-search"
                label={brew.workbenchSearchSources}
                value={sourceQuery}
                onChange={setSourceQuery}
                placeholder={brew.workbenchSearchSources}
                inputType="search"
                size="sm"
                layout="vertical"
                autoComplete="off"
                className="brew-workbench__title-search"
              />
            }
            action={
              <>
                <PageAction
                  label={brew.refreshAllSources}
                  description={brew.workbenchSourceList}
                  icon={<LuRefreshCw />}
                  disabled={!canRefreshSources || sourceRefreshing}
                  loading={sourceRefreshing}
                  onPick={() => {
                    setSourceRefreshing(true)
                    Promise.resolve(onRefreshSources()).finally(() =>
                      setSourceRefreshing(false),
                    )
                  }}
                />
                <PageAction
                  label={brew.addSubscription}
                  description={brew.workbenchSourceList}
                  icon={<LuPlus />}
                  onPick={() => open('add')}
                />
              </>
            }
          >
            <SettingItemWrapper
              itemKey="workbench-sort"
              label={brew.workbenchDefaultSort}
              layout="horizontal"
            >
              <SegmentedControl
                size="sm"
                value={sortMode}
                ariaLabel={brew.workbenchDefaultSort}
                onChange={(mode) => {
                  writeSourceSortMode(mode)
                  setSortMode(mode)
                }}
                options={SORTS.map((item) => ({
                  value: item.id,
                  label: brew[item.label],
                }))}
              />
            </SettingItemWrapper>
            {boundAdmin}
          </WorkbenchPage>
        ) : null}

        {pane === 'add' ? (
          <WorkbenchPage
            title={brew.addSubscription}
            icon={<LuPlus />}
            back={backToSources}
          >
            {boundAdmin}
          </WorkbenchPage>
        ) : null}

        {pane === 'rsshub' ? (
          <WorkbenchPage
            title={brew.workbenchRsshub}
            icon={<LuServer />}
            description={brew.workbenchRsshubHint}
            back={back}
          >
            {admin}
          </WorkbenchPage>
        ) : null}

        {pane === 'notesIo' ? (
          <WorkbenchPage
            title={brew.workbenchNavTransfer}
            icon={<LuUpload />}
            description={brew.workbenchNoteTransferHint}
            back={back}
          >
            {NOTE_TRANSFER_FORMATS.map((item) => (
              <SettingItemWrapper
                key={item.kind}
                itemKey={`transfer-${item.kind}`}
                label={brew[item.title]}
                description={brew[item.hint]}
                icon={item.icon}
              >
                <TransferActions
                  mark={item.icon}
                  accept={item.accept}
                  busy={notesBusy}
                  canExport={docs.length > 0}
                  progress={notesKind === item.kind ? notesProgress : null}
                  dropLabel={format(brew.workbenchDropNamed, {
                    name: brew[item.title],
                  })}
                  formatsLabel={format(brew.workbenchDropFormats, {
                    formats: item.formats,
                  })}
                  startLabel={brew.startImport}
                  exportLabel={brew.workbenchExportNotes}
                  onExport={() => onExportNotes(item.kind)}
                  onImport={(file) => onImportNotes(item.kind, file)}
                />
              </SettingItemWrapper>
            ))}
          </WorkbenchPage>
        ) : null}

        {pane === 'feedsIo' ? (
          <WorkbenchPage
            title={brew.workbenchNavTransfer}
            icon={<LuPackage />}
            description={brew.workbenchFeedTransferHint}
            back={back}
          >
            <SettingItemWrapper
              itemKey="transfer-brewpack"
              label={brew.workbenchBrewpack}
              description={brew.workbenchBrewpackHint}
            >
              <TransferActions
                accept=".brewpack,.zip,application/zip"
                busy={packBusy}
                canExport={sourceCount > 0}
                progress={packProgress}
                dropLabel={format(brew.workbenchDropNamed, {
                  name: brew.workbenchBrewpack,
                })}
                formatsLabel={format(brew.workbenchDropFormats, {
                  formats: '.brewpack / .zip',
                })}
                startLabel={brew.startImport}
                exportLabel={brew.exportBrewpack}
                onExport={onExportPack}
                onImport={onImportPack}
              />
            </SettingItemWrapper>
            <SettingItemWrapper
              itemKey="transfer-opml"
              label={brew.workbenchOpml}
              description={brew.workbenchOpmlHint}
            >
              {admin}
            </SettingItemWrapper>
          </WorkbenchPage>
        ) : null}
      </div>
    </div>
  )
}
