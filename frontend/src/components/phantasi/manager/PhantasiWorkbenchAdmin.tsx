/** 工作台订阅管理。皮不进口这一层。 */

import type {
  AddSourceInput,
  PhantasiSource,
  UpdateSourceRequest,
} from '../../../types/phantasi'
import type { ManagedListItem } from '../../settings/ManagedList'
import type { WorkbenchPane, WorkbenchSourceKind } from '../logic/board'
import type { WorkbenchSourceStatus } from '../logic/sourceStatus'
import { LuRss, LuTag } from '@lib/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import * as phantasiApi from '../../../services/phantasiApi'
import { useModuleVisibilityPreferences } from '../../../utils/moduleVisibility'
import { userFacingError } from '../../../utils/userFacingError'
import { ButtonItem, ManagedList, SwitchItem } from '../../settings'
import { BatchCategoryPick } from '../BatchCategoryPick'
import { getIconUrl, isFriendLinkCategory, isMineCategory } from '../constants'
import {
  collectSourceCategories,
  collectWorkbenchSourceCategories,
  collectWorkbenchSourceKinds,
  isSiteSource,
  sourceMatchesCategory,
  sourceMatchesKind,
  workbenchSourceKind,
} from '../logic/board'
import { listPickerCategories } from '../logic/categories'
import { notesRssUrl, sourceRssShareUrl } from '../logic/shareRss'
import {
  workbenchSourceStatus,
  workbenchSourceStatusTone,
} from '../logic/sourceStatus'
import { noteScheduleLabel } from '../notes/noteBoard'
import { listSelectChrome, useListSelection } from '../useListSelection'
import { AddMode } from './modes'
import { toAddSourceInput } from './modes/addSource'
import { EditSourceMode } from './modes/EditSourceMode'
import RSSHubConfigComponent from './RSSHubConfig'
import { RSSHubInstances } from './RSSHubInstances'
import { shareRssAddress } from './shareRss'

type SourceKindFilter = 'all' | WorkbenchSourceKind

function categoryFilterLabel(
  name: string,
  labels: { friendLinks: string; me: string },
): string {
  if (isFriendLinkCategory(name)) return labels.friendLinks
  if (isMineCategory(name)) return labels.me
  return name
}

function sourceKindLabel(
  kind: WorkbenchSourceKind,
  phantasi: {
    boardNotes: string
    pureLink: string
    workbenchRsshub: string
  },
): string {
  if (kind === 'note') return phantasi.boardNotes
  if (kind === 'link') return phantasi.pureLink
  if (kind === 'rsshub') return phantasi.workbenchRsshub
  if (kind === 'notion') return 'Notion'
  return 'RSS'
}

function sourceStatusLabel(
  status: WorkbenchSourceStatus,
  phantasi: {
    workbenchSourcePaused: string
    workbenchSourceOk: string
    workbenchSourcePending: string
    workbenchSourceOnceFailed: string
    workbenchHomeSourceFailed: string
    workbenchSourceRefreshing: string
  },
): string | null {
  if (status === 'paused') return phantasi.workbenchSourcePaused
  if (status === 'ok') return phantasi.workbenchSourceOk
  if (status === 'pending') return phantasi.workbenchSourcePending
  if (status === 'error') return phantasi.workbenchSourceOnceFailed
  if (status === 'failed') return phantasi.workbenchHomeSourceFailed
  if (status === 'refreshing') return phantasi.workbenchSourceRefreshing
  return null
}

export function PhantasiWorkbenchAdmin({
  pane,
  query: queryProp,
  refreshingAll = false,
  onAdded,
  sources,
  onAddSource,
  onDiscover,
  onImportOpml,
  onExportOpml,
  onUpdateSource,
  onRemoveSources,
  onRefreshSource,
  onGenerateStyleTags,
  extraCategories = [],
  onAssignSources,
}: {
  pane: Extract<WorkbenchPane, 'sources' | 'add' | 'rsshub' | 'feedsIo'>
  query?: string
  refreshingAll?: boolean
  onAdded?: () => void
  extraCategories?: readonly string[]
  onAssignSources?: (ids: number[], category: string) => void
  sources: PhantasiSource[]
  onAddSource: (input: AddSourceInput) => Promise<void>
  onDiscover: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{
    url: string
    title: string
    feed_type: string
    autocompleted: boolean
  } | null>
  onImportOpml: (
    content: string,
    signal?: AbortSignal,
  ) => Promise<{ imported: number; skipped: number }>
  onExportOpml: () => void
  onUpdateSource: (id: number, data: UpdateSourceRequest) => Promise<void>
  onRemoveSources: (ids: number[]) => Promise<void>
  onRefreshSource: (sourceId: number) => void
  onGenerateStyleTags: (
    sourceId: number,
    signal?: AbortSignal,
  ) => Promise<{ success: boolean; tags?: string[] }>
}) {
  const { t, format, locale } = useI18n()
  const phantasi = t.phantasi
  const { preferences: moduleVisibility } = useModuleVisibilityPreferences()
  const phantasiPublic = moduleVisibility.modules.phantasi === 'all'
  const notesFeedUrl = notesRssUrl(
    typeof window === 'undefined' ? '' : window.location.origin,
  )
  const [notesRssEnabled, setNotesRssEnabled] = useState(false)
  const [notesRssSaving, setNotesRssSaving] = useState(false)
  const notesRssShareable = notesRssEnabled && phantasiPublic

  useEffect(() => {
    if (pane !== 'sources') return
    let cancelled = false
    void phantasiApi
      .getNotesRssSettings()
      .then((settings) => {
        if (!cancelled) setNotesRssEnabled(settings.enabled)
      })
      .catch(() => {
        if (!cancelled) setNotesRssEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [pane])

  const handleNotesRssEnabled = useCallback((next: boolean) => {
    setNotesRssEnabled(next)
    setNotesRssSaving(true)
    void phantasiApi
      .setNotesRssEnabled(next)
      .then((enabled) => {
        setNotesRssEnabled(enabled)
      })
      .catch(() => {
        setNotesRssEnabled(!next)
      })
      .finally(() => {
        setNotesRssSaving(false)
      })
  }, [])
  const query = queryProp ?? ''
  const [kindFilter, setKindFilter] = useState<SourceKindFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [removing, setRemoving] = useState(false)

  const categories = useMemo(
    () =>
      listPickerCategories([
        ...extraCategories,
        ...collectSourceCategories(sources),
      ]),
    [extraCategories, sources],
  )

  const handleAddSubmit = useCallback(
    async (data: Parameters<typeof toAddSourceInput>[0]) => {
      try {
        await onAddSource(toAddSourceInput(data))
        onAdded?.()
        return { success: true as const }
      } catch (err) {
        return {
          success: false as const,
          error: userFacingError(err, phantasi.errorAddFailed),
        }
      }
    },
    [phantasi.errorAddFailed, onAddSource, onAdded],
  )

  const categoryOptions = useMemo(() => {
    const labels = { friendLinks: phantasi.friendLinks, me: phantasi.me }
    return [
      { key: 'all', label: phantasi.noteCategoryAll },
      ...collectWorkbenchSourceCategories(sources).map((name) => ({
        key: name,
        label: categoryFilterLabel(name, labels),
      })),
    ]
  }, [phantasi.friendLinks, phantasi.me, phantasi.noteCategoryAll, sources])

  const kindOptions = useMemo(
    () => [
      { key: 'all', label: phantasi.noteCategoryAll },
      ...collectWorkbenchSourceKinds(sources).map((kind) => ({
        key: kind,
        label: sourceKindLabel(kind, phantasi),
      })),
    ],
    [phantasi, sources],
  )

  const resolvedCategory = categoryOptions.some(
    (item) => item.key === categoryFilter,
  )
    ? categoryFilter
    : 'all'

  const resolvedKind = kindOptions.some((item) => item.key === kindFilter)
    ? kindFilter
    : 'all'

  const visible = useMemo(() => {
    const typed =
      resolvedKind === 'all'
        ? sources
        : sources.filter((source) => sourceMatchesKind(source, resolvedKind))
    const scoped =
      resolvedCategory === 'all'
        ? typed
        : typed.filter((source) =>
            sourceMatchesCategory(source, resolvedCategory),
          )
    const needle = query.trim().toLowerCase()
    if (!needle) return scoped
    return scoped.filter(
      (source) =>
        source.name.toLowerCase().includes(needle) ||
        source.url.toLowerCase().includes(needle) ||
        (source.category?.toLowerCase().includes(needle) ?? false),
    )
  }, [query, resolvedCategory, resolvedKind, sources])

  const sourceIds = useMemo(
    () => visible.map((source) => source.id),
    [visible],
  )
  const sourceSelect = useListSelection(sourceIds)

  useEffect(() => {
    if (pane !== 'sources') sourceSelect.exit()
  }, [pane, sourceSelect.exit])

  const sourceSelectBar = listSelectChrome({
    selecting: sourceSelect.selecting,
    picked: sourceSelect.picked,
    total: sourceSelect.total,
    allOn: sourceSelect.allOn,
    busy: removing || refreshingAll,
    labels: {
      edit: phantasi.edit,
      selectAll: phantasi.selectAll,
      deselectAll: phantasi.deselectAll,
      deleteSelected: phantasi.deleteSelected,
      deleteConfirm: format(phantasi.workbenchDeleteSelectedSourcesConfirm, {
        count: sourceSelect.picked,
      }),
      exitEdit: phantasi.exitEdit,
      selectedLabel: phantasi.editMode,
    },
    onEnter: sourceSelect.enter,
    onExit: sourceSelect.exit,
    onSelectAll: sourceSelect.selectAll,
    onDelete: () => {
      const ids = visible
        .filter((source) => sourceSelect.selected.has(source.id))
        .map((source) => source.id)
      if (ids.length === 0) return
      setRemoving(true)
      sourceSelect.exit()
      void onRemoveSources(ids).finally(() => {
        setRemoving(false)
        setEditingId(null)
      })
    },
  })

  const items = useMemo<ManagedListItem[]>(
    () =>
      visible.map((source) => {
        const icon = getIconUrl(source.icon)
        const kind = sourceKindLabel(workbenchSourceKind(source), phantasi)
        const canRefresh = !isSiteSource(source)
        const shareUrl = sourceRssShareUrl(source, window.location.origin)
        const editing = editingId === source.id
        const picking = sourceSelect.selecting
        const refreshing = refreshingId === source.id
        const status = workbenchSourceStatus(source, refreshing)
        const statusLabel = sourceStatusLabel(status, phantasi)
        const statusTone = workbenchSourceStatusTone(status)
        const when =
          status === 'ok' || status === 'paused'
            ? noteScheduleLabel(source.last_success_at, locale)
            : ''
        const failText =
          status === 'failed' || status === 'error'
            ? userFacingError(source.last_error, statusLabel ?? '')
            : ''
        return {
          id: source.id,
          title: source.name,
          subtitle: [kind, source.category, source.url]
            .filter(Boolean)
            .join(' · '),
          meta: failText || when || undefined,
          badges: [
            ...(statusLabel && statusTone
              ? [{ label: statusLabel, tone: statusTone }]
              : []),
            { label: kind, tone: canRefresh ? 'default' as const : 'muted' as const },
          ],
          leading: icon ? (
            <img className="phantasi-workbench__thumb" src={icon} alt="" />
          ) : (
            <span className="phantasi-workbench__thumb is-empty" />
          ),
          selected: sourceSelect.selected.has(source.id),
          onSelect: picking ? () => sourceSelect.toggle(source.id) : undefined,
          renderHit: picking
            ? ({ leading, main }) => (
                <button
                  type="button"
                  className="managed-list-row-hit"
                  onClick={() => sourceSelect.toggle(source.id)}
                >
                  {leading}
                  {main}
                </button>
              )
            : undefined,
          expanded: picking ? false : editing,
          onToggleExpand: picking
            ? undefined
            : () =>
                setEditingId((current) =>
                  current === source.id ? null : source.id,
                ),
          expandContent:
            !picking && editing ? (
              <EditSourceMode
                key={source.id}
                source={source}
                categories={categories}
                onSave={async (id, data) => {
                  await onUpdateSource(id, data)
                  setEditingId(null)
                }}
                onGenerateStyleTags={onGenerateStyleTags}
                onDiscover={onDiscover}
                notesRssEnabled={notesRssShareable}
              />
            ) : null,
          busy: refreshingId === source.id || removing,
          actions: picking
            ? []
            : [
                ...(canRefresh
                  ? [
                      {
                        key: 'refresh',
                        label: phantasi.refreshSource,
                        loading: refreshingId === source.id,
                        disabled: refreshingAll || removing,
                        onClick: () => {
                          setRefreshingId(source.id)
                          Promise.resolve(onRefreshSource(source.id)).finally(
                            () => {
                              setRefreshingId((current) =>
                                current === source.id ? null : current,
                              )
                            },
                          )
                        },
                      },
                    ]
                  : []),
                ...(shareUrl && notesRssShareable
                  ? [
                      {
                        key: 'share',
                        label: phantasi.shareRss,
                        disabled: removing,
                        onClick: () => {
                          void shareRssAddress(
                            shareUrl,
                            source.name,
                            phantasi.rssCopied,
                            t.errors.clipboardFailed,
                          )
                        },
                      },
                    ]
                  : []),
                {
                  key: 'edit',
                  label: phantasi.edit,
                  disabled: removing,
                  onClick: () =>
                    setEditingId((current) =>
                      current === source.id ? null : source.id,
                    ),
                },
                {
                  key: 'delete',
                  label: phantasi.delete,
                  variant: 'danger' as const,
                  confirm: format(phantasi.workbenchDeleteSourceConfirm, {
                    name: source.name,
                  }),
                  disabled: removing,
                  onClick: () => {
                    setRemoving(true)
                    void onRemoveSources([source.id]).finally(() => {
                      setRemoving(false)
                      setEditingId((current) =>
                        current === source.id ? null : current,
                      )
                    })
                  },
                },
              ],
        }
      }),
    [
      phantasi,
      t.errors.clipboardFailed,
      categories,
      editingId,
      format,
      locale,
      onDiscover,
      onGenerateStyleTags,
      onRefreshSource,
      onRemoveSources,
      onUpdateSource,
      refreshingAll,
      refreshingId,
      removing,
      sourceSelect.selecting,
      sourceSelect.selected,
      sourceSelect.toggle,
      notesRssShareable,
      visible,
    ],
  )

  return (
    <>
      {pane === 'rsshub' ? (
        <div id="workbench-rsshub">
          <RSSHubInstances layout="page" onChange={() => {}} />
        </div>
      ) : null}

      {pane === 'feedsIo' ? (
        <div id="workbench-opml">
          <AddMode
            tabs="opml"
            allCategories={categories}
            sourcesCount={sources.length}
            onImportOpml={onImportOpml}
            onExportOpml={onExportOpml}
          />
        </div>
      ) : null}

      {pane === 'add' ? (
        <div id="workbench-add">
          <AddMode
            tabs="single"
            allCategories={categories}
            sourcesCount={sources.length}
            onSubmit={handleAddSubmit}
            onDiscover={onDiscover}
            RSSHubConfigComponent={RSSHubConfigComponent}
          />
        </div>
      ) : null}

      {pane === 'sources' ? (
        <div id="workbench-sources">
          <SwitchItem
            itemKey="workbench-notes-rss"
            label={phantasi.notesRss}
            description={
              notesRssEnabled && !phantasiPublic
                ? phantasi.notesRssPrivate
                : phantasi.notesRssHint
            }
            hint={notesRssShareable ? notesFeedUrl : undefined}
            value={notesRssEnabled}
            onChange={handleNotesRssEnabled}
            loading={notesRssSaving}
            size="sm"
            layout="horizontal"
          />
          {notesRssShareable ? (
            <ButtonItem
              itemKey="workbench-notes-rss-share"
              label={phantasi.shareRss}
              buttonText={phantasi.shareRss}
              buttonIcon={<LuRss />}
              size="sm"
              layout="horizontal"
              onClick={() => {
                void shareRssAddress(
                  notesFeedUrl,
                  phantasi.notesRss,
                  phantasi.rssCopied,
                  t.errors.clipboardFailed,
                )
              }}
            />
          ) : null}
          <ManagedList
            stats={sourceSelectBar.stats}
            toolbar={sourceSelectBar.toolbar}
            toolbarPlacement="filters"
            toolbarExtra={
              sourceSelect.selecting ? (
                <BatchCategoryPick
                  names={categories}
                  disabled={removing || refreshingAll}
                  placeholder={phantasi.workbenchAssignCategory}
                  searchPlaceholder={phantasi.workbenchSearchCategories}
                  emptyText={phantasi.workbenchCategoryKindEmpty}
                  labelFor={(name) =>
                    categoryFilterLabel(name, {
                      friendLinks: phantasi.friendLinks,
                      me: phantasi.me,
                    })
                  }
                  onPick={(name) => {
                    const ids = visible
                      .filter((source) => sourceSelect.selected.has(source.id))
                      .map((source) => source.id)
                    if (ids.length === 0) return
                    onAssignSources?.(ids, name)
                  }}
                />
              ) : null
            }
            filterGroups={[
              {
                label: phantasi.sourceTypeLabel,
                icon: <LuRss />,
                ariaLabel: phantasi.sourceTypeLabel,
                options: kindOptions,
                value: resolvedKind,
                onChange: (key) => setKindFilter(key as SourceKindFilter),
              },
              {
                label: phantasi.category,
                icon: <LuTag />,
                ariaLabel: phantasi.category,
                options: categoryOptions,
                value: resolvedCategory,
                onChange: setCategoryFilter,
              },
            ]}
            queryCollapsible={false}
            queryChrome="plain"
            working={removing || refreshingAll}
            items={items}
            emptyText={
              sources.length === 0
                ? phantasi.workbenchSourceEmpty
                : phantasi.workbenchSourceKindEmpty
            }
            maxHeight={null}
          />
        </div>
      ) : null}
    </>
  )
}
