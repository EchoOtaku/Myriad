/** 管理员工作台皮。不进口 phantasiApi / manager。侧栏一页一项，分类标题用 SettingSection。 */

import type { ReactElement, ReactNode } from 'react'
import type { MediaAsset } from '../../../services/mediaApi'
import type { PhantasiNoteDoc, PhantasiSource } from '../../../types/phantasi'
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
  LuImage,
  LuList,
  LuNotebookPen,
  LuPlus,
  LuRefreshCw,
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
import { BatchCategoryPick } from '../BatchCategoryPick'
import { getImageUrl } from '../constants'
import { usePhantasiGuides } from '../guides/usePhantasiGuides'
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
import {
  workbenchFeedSourceCount,
  workbenchHomeDrafts,
  workbenchHomeIsEmpty,
  workbenchHomeMediaFace,
  workbenchHomeQuietFails,
  workbenchHomeRecent,
  workbenchHomeScheduleKind,
  workbenchHomeUpcoming,
} from '../logic/workbenchHome'
import { noteScheduleLabel } from '../notes/noteBoard'
import { displayImageUrl } from '../notes/noteImageUrl'
import { PhantasiWorkbenchIcon } from '../ui/PhantasiWorkbenchIcon'
import { listSelectChrome, useListSelection } from '../useListSelection'
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
    icon: <PhantasiWorkbenchIcon kind="overview" />,
    pack: 'content',
  },
  {
    pane: 'notes',
    label: 'workbenchNotes',
    icon: <PhantasiWorkbenchIcon kind="notes" />,
    pack: 'content',
  },
  {
    pane: 'media',
    label: 'workbenchMedia',
    icon: <PhantasiWorkbenchIcon kind="media" />,
    pack: 'content',
  },
  {
    pane: 'notesIo',
    label: 'workbenchNavTransfer',
    icon: <PhantasiWorkbenchIcon kind="notes-transfer" />,
    pack: 'content',
  },
  {
    pane: 'sources',
    label: 'workbenchSources',
    icon: <PhantasiWorkbenchIcon kind="sources" />,
    pack: 'feeds',
  },
  {
    pane: 'rsshub',
    label: 'workbenchRsshub',
    icon: <PhantasiWorkbenchIcon kind="rsshub" />,
    pack: 'feeds',
  },
  {
    pane: 'feedsIo',
    label: 'workbenchNavTransfer',
    icon: <PhantasiWorkbenchIcon kind="feeds-transfer" />,
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
  const className = cover ? 'phantasi-workbench__cover' : 'phantasi-workbench__thumb'
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
  guide,
  guidePath,
  action,
  search,
  back,
  children,
}: {
  title: string
  icon: ReactNode
  guide?: ReactNode
  guidePath?: string
  action?: ReactNode
  search?: ReactNode
  back: ReactNode
  children: ReactNode
}) {
  return (
    <SettingSection
      title={title}
      icon={icon}
      guide={guide}
      guidePath={guidePath}
      descriptionVisible={false}
      subtitle={search}
      headerLeading={back}
      headerActions={action ?? false}
      showResetPage={false}
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
    <div className="phantasi-workbench__transfer">
      <button
        type="button"
        className={`phantasi-workbench__drop${dragOver ? ' is-on' : ''}`}
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
          className="phantasi-workbench__drop-file"
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
      <div className="phantasi-workbench__transfer-actions">
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

function HomeBlock({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="phantasi-workbench__home-block">
      <h3>{title}</h3>
      <div className="phantasi-workbench__home-list">{children}</div>
    </section>
  )
}

function homeFaceSrc(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  return getImageUrl(raw) || displayImageUrl(raw)
}

function HomeRow({
  title,
  meta,
  excerpt,
  src,
  video = false,
  quiet = false,
  onPick,
}: {
  title: string
  meta?: string
  excerpt?: string
  src?: string
  video?: boolean
  quiet?: boolean
  onPick: () => void
}) {
  const face = Boolean(src) && !quiet
  return (
    <button
      type="button"
      className={`phantasi-workbench__home-row${quiet ? ' is-quiet' : ''}${face ? ' has-face' : ''}`}
      onClick={onPick}
    >
      {face ? <Thumb cover src={src} video={video} /> : null}
      <span className="phantasi-workbench__home-row-copy">
        <span className="phantasi-workbench__home-row-title">{title}</span>
        {face && excerpt ? (
          <span className="phantasi-workbench__home-row-excerpt">{excerpt}</span>
        ) : null}
        {meta ? (
          <span className="phantasi-workbench__home-row-meta">{meta}</span>
        ) : null}
      </span>
    </button>
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
      className={`phantasi-workbench__kpi${tone ? ` is-${tone}` : ''}`}
      onClick={onPick}
    >
      <span className="phantasi-workbench__kpi-value">{value}</span>
      <span className="phantasi-workbench__kpi-label">{label}</span>
    </button>
  )
}

export default function PhantasiWorkbench({
  pane,
  onPane,
  docs,
  media,
  notesLoading,
  mediaLoading,
  busy,
  sourceCount,
  sources = [],
  packBusy,
  packProgress,
  onWrite,
  onOpenNote,
  onDeleteNotes,
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
  noteCategories = [],
  onAssignNotes,
  admin,
}: {
  pane: WorkbenchPane
  onPane: (pane: WorkbenchPane) => void
  docs: PhantasiNoteDoc[]
  media: MediaAsset[]
  notesLoading: boolean
  mediaLoading: boolean
  busy: boolean
  sourceCount: number
  sources?: readonly PhantasiSource[]
  packBusy: boolean
  packProgress: string | null
  onWrite: () => void
  onOpenNote: (open: ReturnType<typeof workbenchNoteOpen>) => void
  onDeleteNotes: (docs: PhantasiNoteDoc[]) => void
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
  noteCategories?: readonly string[]
  onAssignNotes?: (docs: PhantasiNoteDoc[], category: string) => void
  admin?: ReactNode
}) {
  const { t, locale, format } = useI18n()
  const phantasi = t.phantasi
  const { catalog: g, bindGuide } = usePhantasiGuides()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mobilePane, setMobilePane] = useState<'nav' | 'section'>('section')
  const [mediaKind, setMediaKind] = useState<WorkbenchMediaKindFilter>('all')
  const [mediaFormat, setMediaFormat] =
    useState<WorkbenchMediaFormatFilter>('all')
  const [mediaQuery, setMediaQuery] = useState('')
  const [mediaLayout, setMediaLayout] = useState<'list' | 'grid'>('grid')
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceRefreshing, setSourceRefreshing] = useState(false)

  const [categoryQuery, setCategoryQuery] = useState('')

  useEffect(() => {
    if (pane !== 'sources') setSourceQuery('')
    if (pane !== 'noteCategories' && pane !== 'sourceCategories') {
      setCategoryQuery('')
    }
  }, [pane])

  const boundAdmin =
    (pane === 'sources' ||
      pane === 'add' ||
      pane === 'noteCategories' ||
      pane === 'sourceCategories') &&
    isValidElement(admin)
      ? cloneElement(
          admin as ReactElement<{
            query?: string
            refreshingAll?: boolean
            onAdded?: () => void
          }>,
          {
            query:
              pane === 'noteCategories' || pane === 'sourceCategories'
                ? categoryQuery
                : sourceQuery,
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
      { key: 'all', label: phantasi.workbenchMediaAll },
      ...mediaFormats.map((key) => ({
        key,
        label: workbenchMediaFormatLabel(key, phantasi.workbenchMediaFormatOther),
      })),
    ],
    [phantasi.workbenchMediaAll, phantasi.workbenchMediaFormatOther, mediaFormats],
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
      { key: 'all', label: phantasi.noteCategoryAll },
      ...noteTopics.map((name) => ({ key: name, label: name })),
    ],
    [phantasi.noteCategoryAll, noteTopics],
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
  const noteIds = useMemo(
    () => visibleNotes.map((doc) => doc.id),
    [visibleNotes],
  )
  const notesSelect = useListSelection(noteIds)

  useEffect(() => {
    if (pane !== 'notes') notesSelect.exit()
  }, [notesSelect.exit, pane])

  const notesSelectBar = listSelectChrome({
    selecting: notesSelect.selecting,
    picked: notesSelect.picked,
    total: notesSelect.total,
    allOn: notesSelect.allOn,
    busy,
    labels: {
      edit: phantasi.edit,
      selectAll: phantasi.selectAll,
      deselectAll: phantasi.deselectAll,
      deleteSelected: phantasi.deleteSelected,
      deleteConfirm: format(phantasi.workbenchDeleteSelectedNotesConfirm, {
        count: notesSelect.picked,
      }),
      exitEdit: phantasi.exitEdit,
      selectedLabel: phantasi.editMode,
    },
    onEnter: notesSelect.enter,
    onExit: notesSelect.exit,
    onSelectAll: notesSelect.selectAll,
    onDelete: () => {
      const docs = visibleNotes.filter((doc) =>
        notesSelect.selected.has(doc.id),
      )
      if (docs.length === 0) return
      notesSelect.exit()
      onDeleteNotes(docs)
    },
  })
  const feedCount = workbenchFeedSourceCount(sources)
  const homeEmpty = workbenchHomeIsEmpty(docs.length, feedCount, media.length)
  const homeDrafts = useMemo(() => workbenchHomeDrafts(docs), [docs])
  const homeUpcoming = useMemo(() => workbenchHomeUpcoming(docs), [docs])
  const homeQuiet = useMemo(
    () => workbenchHomeQuietFails(docs, sources),
    [docs, sources],
  )
  const homeRecent = useMemo(
    () =>
      workbenchHomeRecent({
        notes: docs,
        skipNoteIds: new Set([
          ...homeDrafts.map((doc) => doc.id),
          ...homeUpcoming.map((doc) => doc.id),
          ...homeQuiet.notes.map((doc) => doc.id),
        ]),
        sources,
        skipSourceIds: new Set(homeQuiet.sources.map((source) => source.id)),
        media,
      }),
    [docs, homeDrafts, homeQuiet, homeUpcoming, media, sources],
  )

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
      className="section-header-back phantasi-workbench__parent-back"
      onClick={() => open('sources')}
      aria-label={phantasi.workbenchSources}
    >
      <LuChevronLeft size={18} aria-hidden />
      <span>{t.common.back}</span>
    </button>
  )

  const backToNotes = (
    <button
      type="button"
      className="section-header-back phantasi-workbench__parent-back"
      onClick={() => open('notes')}
      aria-label={phantasi.workbenchNotes}
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
        const picking = notesSelect.selecting
        return {
          id: doc.id,
          title: doc.title.trim() || phantasi.workbenchNoteUntitled,
          subtitle: excerpt || facts || undefined,
          meta: excerpt && facts ? facts : undefined,
          badge: {
            label: phantasi[statusKey],
            tone: noteTone(statusKey, Boolean(doc.last_error)),
          },
          className: picking
            ? 'phantasi-workbench__note'
            : 'phantasi-workbench__note phantasi-workbench__hover-actions',
          leading: (
            <Thumb
              cover
              src={getImageUrl(workbenchNoteCover(doc)) || undefined}
            />
          ),
          selected: notesSelect.selected.has(doc.id),
          onSelect: picking ? () => notesSelect.toggle(doc.id) : undefined,
          renderHit: ({ leading, main }) => (
            <button
              type="button"
              className="managed-list-row-hit"
              disabled={busy}
              onClick={() =>
                picking
                  ? notesSelect.toggle(doc.id)
                  : onOpenNote(workbenchNoteOpen(doc))
              }
            >
              {leading}
              {main}
            </button>
          ),
          actions: picking
            ? []
            : [
                ...(doc.status === 'scheduled'
                  ? [
                      {
                        key: 'unschedule',
                        label: phantasi.workbenchUnschedule,
                        onClick: () => onUnschedule(doc.id),
                        disabled: busy,
                      },
                    ]
                  : []),
                {
                  key: 'delete',
                  label: phantasi.delete,
                  variant: 'danger' as const,
                  confirm: phantasi.workbenchDeleteConfirm,
                  onClick: () => onDeleteNotes([doc]),
                  disabled: busy,
                },
              ],
        }
      }),
    [
      busy,
      phantasi,
      locale,
      notesSelect.selecting,
      notesSelect.selected,
      notesSelect.toggle,
      onDeleteNotes,
      onOpenNote,
      onUnschedule,
      visibleNotes,
    ],
  )

  const mediaItems = useMemo<ManagedListItem[]>(
    () =>
      visibleMedia.map((item) => {
        const src = displayImageUrl(item.url)
        const inUse = item.references.length > 0
        const refs = workbenchMediaRefLabel(item.references, {
          notes: phantasi.workbenchNotes,
          articles: phantasi.articles,
          site: phantasi.workbenchMediaRefSite,
        })
        const formatKey = workbenchMediaFormatKey(item)
        const format = workbenchMediaFormatLabel(
          formatKey,
          phantasi.workbenchMediaFormatOther,
        )
        const size = formatWorkbenchBytes(item.size)
        const when = noteScheduleLabel(item.created_at, locale)
        const kind =
          item.kind === 'generated'
            ? phantasi.workbenchMediaGeneratedKind
            : phantasi.workbenchMediaUploadKind
        const video = item.mime.startsWith('video/')
        return {
          id: item.id,
          title: item.name,
          subtitle: [size, when].filter(Boolean).join(' · '),
          meta: inUse
            ? refs || phantasi.workbenchMediaInUse
            : phantasi.workbenchMediaUnused,
          badges: [
            { label: format, tone: video ? 'warn' : 'muted' },
            {
              label: kind,
              tone: item.kind === 'generated' ? 'active' : 'muted',
            },
          ],
          className: 'phantasi-workbench__hover-actions phantasi-workbench__media',
          leading: <Thumb src={src} video={video} />,
          actions: [
            {
              key: 'delete',
              label: phantasi.delete,
              variant: 'danger' as const,
              confirm: phantasi.workbenchDeleteMediaConfirm,
              onClick: () => onDeleteMedia(item.id),
              disabled: busy || inUse,
              title: inUse ? refs || phantasi.workbenchMediaInUse : undefined,
            },
          ],
        }
      }),
    [phantasi, busy, locale, onDeleteMedia, visibleMedia],
  )

  return (
    <div
      className="phantasi-workbench"
      data-phantasi-surface="workbench"
      data-mobile-pane={mobilePane}
    >
      <aside className="config-sidebar phantasi-workbench__rail">
        <div className="config-sidebar-header">
          <span className="nav-icon" aria-hidden>
            <PhantasiWorkbenchIcon kind="studio" />
          </span>
          <div className="config-sidebar-heading">
            <h3 className="nav-title">{phantasi.boardWorkbench}</h3>
            <p className="nav-subtitle">{phantasi.boardWorkbenchTitle}</p>
          </div>
        </div>
        <nav className="config-sidebar-scroll" aria-label={phantasi.boardWorkbench}>
          {RAIL_PACKS.map((pack) => (
            <div key={pack.id} className="config-nav-group">
              <div className="config-nav-group-title">{phantasi[pack.title]}</div>
              {RAIL.filter((item) => item.pack === pack.id).map((item) => (
                <NavBtn
                  key={`${pack.id}-${item.pane}`}
                  label={phantasi[item.label]}
                  icon={item.icon}
                  current={
                    pane === item.pane ||
                    (pane === 'add' && item.pane === 'sources') ||
                    (pane === 'noteCategories' && item.pane === 'notes') ||
                    (pane === 'sourceCategories' && item.pane === 'sources')
                  }
                  onPick={() => open(item.pane)}
                />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="phantasi-workbench__main">
        {pane === 'home' ? (
          <WorkbenchPage
            title={phantasi.workbenchOverview}
            icon={<PhantasiWorkbenchIcon kind="overview" />}
            back={back}
            {...bindGuide('workbench.overview', g.overview)}
            action={
              <>
                <PageAction
                  label={phantasi.noteWrite}
                  description={phantasi.boardNotesTitle}
                  icon={<LuNotebookPen />}
                  disabled={busy}
                  onPick={onWrite}
                />
                <PageAction
                  label={phantasi.addSubscription}
                  description={phantasi.workbenchSourceList}
                  icon={<LuPlus />}
                  onPick={() => open('add')}
                />
              </>
            }
          >
            {homeEmpty ? (
              <p className="phantasi-workbench__home-empty">{phantasi.workbenchHomeEmpty}</p>
            ) : (
              <div className="phantasi-workbench__home">
                {homeDrafts.length > 0 ? (
                  <HomeBlock title={phantasi.workbenchHomeContinue}>
                    {homeDrafts.map((doc) => {
                      const src = homeFaceSrc(workbenchNoteCover(doc))
                      return (
                        <HomeRow
                          key={`draft-${doc.id}`}
                          title={doc.title.trim() || phantasi.workbenchNoteUntitled}
                          excerpt={
                            src
                              ? workbenchNoteExcerpt(doc.content_md) || undefined
                              : undefined
                          }
                          src={src}
                          meta={
                            noteScheduleLabel(doc.updated_at, locale) ||
                            undefined
                          }
                          onPick={() => onOpenNote(workbenchNoteOpen(doc))}
                        />
                      )
                    })}
                  </HomeBlock>
                ) : null}
                {homeUpcoming.length > 0 ? (
                  <HomeBlock title={phantasi.workbenchHomeUpcoming}>
                    {homeUpcoming.map((doc) => {
                      const kind = workbenchHomeScheduleKind(doc.scheduled_at)
                      const when = noteScheduleLabel(doc.scheduled_at, locale)
                      const meta =
                        kind === 'missing'
                          ? phantasi.workbenchHomeScheduleMissing
                          : kind === 'overdue' && when
                            ? `${when} · ${phantasi.workbenchHomeScheduleOverdue}`
                            : kind === 'overdue'
                              ? phantasi.workbenchHomeScheduleOverdue
                              : when || undefined
                      const src = homeFaceSrc(workbenchNoteCover(doc))
                      return (
                        <HomeRow
                          key={`soon-${doc.id}`}
                          title={doc.title.trim() || phantasi.workbenchNoteUntitled}
                          excerpt={
                            src
                              ? workbenchNoteExcerpt(doc.content_md) || undefined
                              : undefined
                          }
                          src={src}
                          meta={meta}
                          onPick={() => onOpenNote(workbenchNoteOpen(doc))}
                        />
                      )
                    })}
                  </HomeBlock>
                ) : null}
                {homeRecent.length > 0 ? (
                  <HomeBlock title={phantasi.workbenchHomeRecent}>
                    {homeRecent.map((item) => {
                      if (item.kind === 'note') {
                        const doc = docs.find((row) => row.id === item.id)
                        if (!doc) return null
                        const when = noteScheduleLabel(doc.updated_at, locale)
                        const src = homeFaceSrc(workbenchNoteCover(doc))
                        return (
                          <HomeRow
                            key={`recent-note-${doc.id}`}
                            title={
                              doc.title.trim() || phantasi.workbenchNoteUntitled
                            }
                            excerpt={
                              src
                                ? workbenchNoteExcerpt(doc.content_md) ||
                                  undefined
                                : undefined
                            }
                            src={src}
                            meta={[phantasi.workbenchHomeRecentNote, when]
                              .filter(Boolean)
                              .join(' · ')}
                            onPick={() => onOpenNote(workbenchNoteOpen(doc))}
                          />
                        )
                      }
                      if (item.kind === 'source') {
                        const source = sources.find((row) => row.id === item.id)
                        if (!source) return null
                        const when = noteScheduleLabel(
                          source.created_at,
                          locale,
                        )
                        return (
                          <HomeRow
                            key={`recent-source-${source.id}`}
                            title={source.name}
                            meta={[phantasi.workbenchHomeRecentSource, when]
                              .filter(Boolean)
                              .join(' · ')}
                            onPick={() => open('sources')}
                          />
                        )
                      }
                      const asset = media.find((row) => row.id === item.id)
                      if (!asset) return null
                      const when = noteScheduleLabel(asset.created_at, locale)
                      const face = workbenchHomeMediaFace(asset)
                      return (
                        <HomeRow
                          key={`recent-media-${asset.id}`}
                          title={asset.name}
                          src={homeFaceSrc(face?.src)}
                          video={face?.video}
                          meta={[phantasi.workbenchHomeRecentMedia, when]
                            .filter(Boolean)
                            .join(' · ')}
                          onPick={() => open('media')}
                        />
                      )
                    })}
                  </HomeBlock>
                ) : null}
                {homeQuiet.notes.length > 0 || homeQuiet.sources.length > 0 ? (
                  <div className="phantasi-workbench__home-quiet">
                    {homeQuiet.notes.map((doc) => (
                      <HomeRow
                        key={`fail-note-${doc.id}`}
                        quiet
                        title={doc.title.trim() || phantasi.workbenchNoteUntitled}
                        meta={phantasi.workbenchHomeNoteFailed}
                        onPick={() => onOpenNote(workbenchNoteOpen(doc))}
                      />
                    ))}
                    {homeQuiet.sources.map((source) => (
                      <HomeRow
                        key={`fail-source-${source.id}`}
                        quiet
                        title={source.name}
                        meta={phantasi.workbenchHomeSourceFailed}
                        onPick={() => open('sources')}
                      />
                    ))}
                  </div>
                ) : null}
                <section
                  className="phantasi-workbench__kpis"
                  aria-label={phantasi.workbenchOverview}
                >
                  <Kpi
                    value={docs.length}
                    label={phantasi.workbenchNotes}
                    onPick={() => open('notes')}
                  />
                  <Kpi
                    value={media.length}
                    label={phantasi.workbenchMedia}
                    onPick={() => open('media')}
                  />
                  <Kpi
                    value={feedCount}
                    label={phantasi.workbenchSources}
                    onPick={() => open('sources')}
                  />
                </section>
              </div>
            )}
          </WorkbenchPage>
        ) : null}

        {pane === 'notes' ? (
          <WorkbenchPage
            title={phantasi.workbenchNotes}
            icon={<PhantasiWorkbenchIcon kind="notes" />}
            back={back}
            {...bindGuide('workbench.notes', g.notes)}
            search={
              <InputItem
                itemKey="workbench-note-search"
                label={phantasi.workbenchSearchNotes}
                value={noteQuery}
                onChange={setNoteQuery}
                placeholder={phantasi.workbenchSearchNotes}
                inputType="search"
                size="sm"
                layout="vertical"
                autoComplete="off"
                className="phantasi-workbench__title-search"
              />
            }
            action={
              <>
                <PageAction
                  label={phantasi.noteWrite}
                  description={phantasi.boardNotesTitle}
                  icon={<LuNotebookPen />}
                  disabled={busy}
                  onPick={onWrite}
                />
                <PageAction
                  label={phantasi.workbenchCategories}
                  description={phantasi.noteTopic}
                  icon={<LuTag />}
                  onPick={() => open('noteCategories')}
                />
              </>
            }
          >
            <ManagedList
              stats={notesSelectBar.stats}
              toolbar={notesSelectBar.toolbar}
              toolbarPlacement="filters"
              toolbarExtra={
                notesSelect.selecting ? (
                  <BatchCategoryPick
                    names={noteCategories}
                    disabled={busy}
                    placeholder={phantasi.workbenchAssignCategory}
                    searchPlaceholder={phantasi.workbenchSearchCategories}
                    emptyText={phantasi.workbenchCategoryKindEmpty}
                    onPick={(name) => {
                      const picked = visibleNotes.filter((doc) =>
                        notesSelect.selected.has(doc.id),
                      )
                      if (picked.length === 0) return
                      onAssignNotes?.(picked, name)
                    }}
                  />
                ) : null
              }
              filterGroups={[
                {
                  label: phantasi.workbenchNoteStatus,
                  icon: <LuClipboardList />,
                  ariaLabel: phantasi.workbenchNoteStatus,
                  options: [
                    { key: 'all', label: phantasi.workbenchMediaAll },
                    { key: 'draft', label: phantasi.noteStatusDraft },
                    { key: 'scheduled', label: phantasi.noteStatusScheduled },
                    { key: 'published', label: phantasi.noteStatusPublished },
                  ],
                  value: noteStatus,
                  onChange: (key) =>
                    setNoteStatus(key as WorkbenchNoteStatusFilter),
                },
                {
                  label: phantasi.noteTopic,
                  icon: <LuTag />,
                  ariaLabel: phantasi.noteTopic,
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
                  ? phantasi.workbenchNoteEmpty
                  : phantasi.workbenchNoteKindEmpty
              }
              maxHeight={null}
            />
          </WorkbenchPage>
        ) : null}

        {pane === 'media' ? (
          <WorkbenchPage
            title={phantasi.workbenchMedia}
            icon={<PhantasiWorkbenchIcon kind="media" />}
            back={back}
            {...bindGuide('workbench.media', g.media)}
            search={
              <InputItem
                itemKey="workbench-media-search"
                label={phantasi.workbenchSearchMedia}
                value={mediaQuery}
                onChange={setMediaQuery}
                placeholder={phantasi.workbenchSearchMedia}
                inputType="search"
                size="sm"
                layout="vertical"
                autoComplete="off"
                className="phantasi-workbench__title-search"
              />
            }
            action={
              <PageAction
                label={phantasi.workbenchUpload}
                description={phantasi.workbenchMedia}
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
                  label: phantasi.workbenchMediaFormat,
                  icon: <LuFileText />,
                  ariaLabel: phantasi.workbenchMediaFormat,
                  options: mediaFormatOptions,
                  value: resolvedMediaFormat,
                  onChange: (key) =>
                    setMediaFormat(key as WorkbenchMediaFormatFilter),
                },
                {
                  label: phantasi.workbenchMediaSource,
                  icon: <LuUpload />,
                  ariaLabel: phantasi.workbenchMediaSource,
                  options: [
                    { key: 'all', label: phantasi.workbenchMediaAll },
                    { key: 'upload', label: phantasi.workbenchMediaUploadKind },
                    {
                      key: 'generated',
                      label: phantasi.workbenchMediaGeneratedKind,
                    },
                  ],
                  value: mediaKind,
                  onChange: (key) =>
                    setMediaKind(key as WorkbenchMediaKindFilter),
                },
                {
                  label: phantasi.workbenchMediaLayout,
                  icon: <LuSquare />,
                  ariaLabel: phantasi.workbenchMediaLayout,
                  options: [
                    {
                      key: 'list',
                      label: phantasi.workbenchMediaLayoutList,
                      icon: <LuList />,
                    },
                    {
                      key: 'grid',
                      label: phantasi.workbenchMediaLayoutGrid,
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
                  ? phantasi.workbenchMediaEmpty
                  : phantasi.workbenchMediaKindEmpty
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
            title={phantasi.workbenchSources}
            icon={<PhantasiWorkbenchIcon kind="sources" />}
            back={back}
            {...bindGuide('workbench.sources', g.sources)}
            search={
              <InputItem
                itemKey="workbench-source-search"
                label={phantasi.workbenchSearchSources}
                value={sourceQuery}
                onChange={setSourceQuery}
                placeholder={phantasi.workbenchSearchSources}
                inputType="search"
                size="sm"
                layout="vertical"
                autoComplete="off"
                className="phantasi-workbench__title-search"
              />
            }
            action={
              <>
                <PageAction
                  label={phantasi.refreshAllSources}
                  description={phantasi.workbenchSourceList}
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
                  label={phantasi.addSubscription}
                  description={phantasi.workbenchSourceList}
                  icon={<LuPlus />}
                  onPick={() => open('add')}
                />
                <PageAction
                  label={phantasi.workbenchCategories}
                  description={phantasi.category}
                  icon={<LuTag />}
                  onPick={() => open('sourceCategories')}
                />
              </>
            }
          >
            <SettingItemWrapper
              itemKey="workbench-sort"
              label={phantasi.workbenchDefaultSort}
              layout="horizontal"
              {...bindGuide('workbench.defaultSort', g.defaultSort)}
            >
              <SegmentedControl
                size="sm"
                value={sortMode}
                ariaLabel={phantasi.workbenchDefaultSort}
                onChange={(mode) => {
                  writeSourceSortMode(mode)
                  setSortMode(mode)
                }}
                options={SORTS.map((item) => ({
                  value: item.id,
                  label: phantasi[item.label],
                }))}
              />
            </SettingItemWrapper>
            {boundAdmin}
          </WorkbenchPage>
        ) : null}

        {pane === 'add' ? (
          <WorkbenchPage
            title={phantasi.addSubscription}
            icon={<LuPlus />}
            back={backToSources}
            {...bindGuide('workbench.add', g.add)}
          >
            {boundAdmin}
          </WorkbenchPage>
        ) : null}

        {pane === 'noteCategories' || pane === 'sourceCategories' ? (
          <WorkbenchPage
            title={phantasi.workbenchCategories}
            icon={<LuTag />}
            {...bindGuide(
              pane === 'noteCategories'
                ? 'workbench.noteCategories'
                : 'workbench.sourceCategories',
              pane === 'noteCategories'
                ? g.noteCategories
                : g.sourceCategories,
            )}
            back={pane === 'noteCategories' ? backToNotes : backToSources}
            search={
              <InputItem
                itemKey="workbench-category-search"
                label={phantasi.workbenchSearchCategories}
                value={categoryQuery}
                onChange={setCategoryQuery}
                placeholder={phantasi.workbenchSearchCategories}
                inputType="search"
                size="sm"
                layout="vertical"
                autoComplete="off"
                className="phantasi-workbench__title-search"
              />
            }
          >
            {boundAdmin}
          </WorkbenchPage>
        ) : null}

        {pane === 'rsshub' ? (
          <WorkbenchPage
            title={phantasi.workbenchRsshub}
            icon={<PhantasiWorkbenchIcon kind="rsshub" />}
            back={back}
            {...bindGuide('workbench.rsshub', g.rsshub)}
            action={
              <div
                id="workbench-rsshub-actions"
                className="phantasi-workbench__rsshub-actions"
              />
            }
          >
            {admin}
          </WorkbenchPage>
        ) : null}

        {pane === 'notesIo' ? (
          <WorkbenchPage
            title={phantasi.workbenchNavTransfer}
            icon={<PhantasiWorkbenchIcon kind="notes-transfer" />}
            back={back}
            {...bindGuide('workbench.notesIo', g.notesIo)}
          >
            {NOTE_TRANSFER_FORMATS.map((item) => (
              <SettingItemWrapper
                key={item.kind}
                itemKey={`transfer-${item.kind}`}
                label={phantasi[item.title]}
                description={phantasi[item.hint]}
                icon={item.icon}
                {...bindGuide(`workbench.${item.kind}`, g[item.kind])}
              >
                <TransferActions
                  mark={item.icon}
                  accept={item.accept}
                  busy={notesBusy}
                  canExport={docs.length > 0}
                  progress={notesKind === item.kind ? notesProgress : null}
                  dropLabel={format(phantasi.workbenchDropNamed, {
                    name: phantasi[item.title],
                  })}
                  formatsLabel={format(phantasi.workbenchDropFormats, {
                    formats: item.formats,
                  })}
                  startLabel={phantasi.startImport}
                  exportLabel={phantasi.workbenchExportNotes}
                  onExport={() => onExportNotes(item.kind)}
                  onImport={(file) => onImportNotes(item.kind, file)}
                />
              </SettingItemWrapper>
            ))}
          </WorkbenchPage>
        ) : null}

        {pane === 'feedsIo' ? (
          <WorkbenchPage
            title={phantasi.workbenchNavTransfer}
            icon={<PhantasiWorkbenchIcon kind="feeds-transfer" />}
            back={back}
            {...bindGuide('workbench.feedsIo', g.feedsIo)}
          >
            <SettingItemWrapper
              itemKey="transfer-pipack"
              label={phantasi.workbenchPipack}
              description={phantasi.workbenchPipackHint}
              {...bindGuide('workbench.pipack', g.pipack)}
            >
              <TransferActions
                accept=".pipack,.zip,application/zip"
                busy={packBusy}
                canExport={sourceCount > 0}
                progress={packProgress}
                dropLabel={format(phantasi.workbenchDropNamed, {
                  name: phantasi.workbenchPipack,
                })}
                formatsLabel={format(phantasi.workbenchDropFormats, {
                  formats: '.pipack / .zip',
                })}
                startLabel={phantasi.startImport}
                exportLabel={phantasi.exportPipack}
                onExport={onExportPack}
                onImport={onImportPack}
              />
            </SettingItemWrapper>
            <SettingItemWrapper
              itemKey="transfer-opml"
              label={phantasi.workbenchOpml}
              description={phantasi.workbenchOpmlHint}
              {...bindGuide('workbench.opml', g.opml)}
            >
              {admin}
            </SettingItemWrapper>
          </WorkbenchPage>
        ) : null}
      </div>
    </div>
  )
}
