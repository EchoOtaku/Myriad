/** 工作台订阅管理。皮不进口这一层。 */

import type {
  AddSourceInput,
  BrewSource,
  UpdateSourceRequest,
} from '../../../types/brew'
import type { ManagedListItem } from '../../settings/ManagedList'
import type { WorkbenchPane, WorkbenchSourceKind } from '../logic/board'
import { LuRss, LuTag } from '@lib/icons'
import { useCallback, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { userFacingError } from '../../../utils/userFacingError'
import { ManagedList } from '../../settings'
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
import { AddMode } from './modes'
import { toAddSourceInput } from './modes/addSource'
import { EditSourceMode } from './modes/EditSourceMode'
import RSSHubConfigComponent from './RSSHubConfig'
import { RSSHubInstances } from './RSSHubInstances'

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
  brew: {
    boardNotes: string
    pureLink: string
    workbenchRsshub: string
  },
): string {
  if (kind === 'note') return brew.boardNotes
  if (kind === 'link') return brew.pureLink
  if (kind === 'rsshub') return brew.workbenchRsshub
  if (kind === 'notion') return 'Notion'
  return 'RSS'
}

export function BrewWorkbenchAdmin({
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
}: {
  pane: Extract<WorkbenchPane, 'sources' | 'add' | 'rsshub' | 'feedsIo'>
  query?: string
  refreshingAll?: boolean
  onAdded?: () => void
  sources: BrewSource[]
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
  const { t, format } = useI18n()
  const brew = t.brew
  const query = queryProp ?? ''
  const [kindFilter, setKindFilter] = useState<SourceKindFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [removing, setRemoving] = useState(false)

  const categories = useMemo(
    () =>
      Iterator.from(
        new Set([brew.friendLinks, brew.me]).union(
          new Set(collectSourceCategories(sources)),
        ),
      ).toArray(),
    [brew.friendLinks, brew.me, sources],
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
          error: userFacingError(err, brew.errorAddFailed),
        }
      }
    },
    [brew.errorAddFailed, onAddSource, onAdded],
  )

  const categoryOptions = useMemo(() => {
    const labels = { friendLinks: brew.friendLinks, me: brew.me }
    return [
      { key: 'all', label: brew.noteCategoryAll },
      ...collectWorkbenchSourceCategories(sources).map((name) => ({
        key: name,
        label: categoryFilterLabel(name, labels),
      })),
    ]
  }, [brew.friendLinks, brew.me, brew.noteCategoryAll, sources])

  const kindOptions = useMemo(
    () => [
      { key: 'all', label: brew.noteCategoryAll },
      ...collectWorkbenchSourceKinds(sources).map((kind) => ({
        key: kind,
        label: sourceKindLabel(kind, brew),
      })),
    ],
    [brew, sources],
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

  const items = useMemo<ManagedListItem[]>(
    () =>
      visible.map((source) => {
        const icon = getIconUrl(source.icon)
        const kind = sourceKindLabel(workbenchSourceKind(source), brew)
        const canRefresh = !isSiteSource(source)
        const editing = editingId === source.id
        return {
          id: source.id,
          title: source.name,
          subtitle: [kind, source.category, source.url]
            .filter(Boolean)
            .join(' · '),
          badge: { label: kind, tone: canRefresh ? 'default' : 'muted' },
          leading: icon ? (
            <img className="brew-workbench__thumb" src={icon} alt="" />
          ) : (
            <span className="brew-workbench__thumb is-empty" />
          ),
          expanded: editing,
          onToggleExpand: () =>
            setEditingId((current) =>
              current === source.id ? null : source.id,
            ),
          expandContent: editing ? (
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
            />
          ) : null,
          busy: refreshingId === source.id || removing,
          actions: [
            ...(canRefresh
              ? [
                  {
                    key: 'refresh',
                    label: brew.refreshSource,
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
            {
              key: 'edit',
              label: brew.edit,
              disabled: removing,
              onClick: () =>
                setEditingId((current) =>
                  current === source.id ? null : source.id,
                ),
            },
            {
              key: 'delete',
              label: brew.delete,
              variant: 'danger' as const,
              confirm: format(brew.workbenchDeleteSourceConfirm, {
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
      brew,
      categories,
      editingId,
      format,
      onGenerateStyleTags,
      onRefreshSource,
      onRemoveSources,
      onUpdateSource,
      refreshingAll,
      refreshingId,
      removing,
      visible,
    ],
  )

  return (
    <>
      {pane === 'rsshub' ? (
        <div id="workbench-rsshub">
          <RSSHubInstances defaultOpen onChange={() => {}} />
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
          <ManagedList
            filterGroups={[
              {
                label: brew.sourceTypeLabel,
                icon: <LuRss />,
                ariaLabel: brew.sourceTypeLabel,
                options: kindOptions,
                value: resolvedKind,
                onChange: (key) => setKindFilter(key as SourceKindFilter),
              },
              {
                label: brew.category,
                icon: <LuTag />,
                ariaLabel: brew.category,
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
                ? brew.emptyNoSources
                : brew.noMatchingSources
            }
            maxHeight={null}
          />
        </div>
      ) : null}
    </>
  )
}
