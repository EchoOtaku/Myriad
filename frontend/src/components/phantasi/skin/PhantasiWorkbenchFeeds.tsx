/** 工作台订阅栏：源、添加、分类、RSSHub。壳不进口这些页。 */

import type { ReactElement, ReactNode } from 'react'
import type { SourceSortMode, WorkbenchPane } from '../logic/board'
import { LuChevronLeft, LuPlus, LuRefreshCw, LuTag } from '@lib/icons'
import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useI18n } from '../../../contexts/I18nContext'
import {
  dispatchModuleVisibilityPreferencesUpdated,
  fetchModuleVisibilityPreferences,
  updateModuleVisibilityPreferences,
  useModuleVisibilityPreferences,
} from '../../../utils/moduleVisibility'
import { showToast } from '../../../utils/toastManager'
import { InputItem, SegmentedControl } from '../../settings'
import { SettingItemWrapper } from '../../settings/items/SettingItemWrapper'
import { isFriendLinkCategory, isMineCategory } from '../constants'
import { usePhantasiGuides } from '../guides/usePhantasiGuides'
import { topicDisplayName } from '../logic/topics'
import { PhantasiWorkbenchIcon } from '../ui/PhantasiWorkbenchIcon'
import { PageAction, WorkbenchPage } from './PhantasiWorkbenchChrome'

const SORTS: Array<{
  id: SourceSortMode
  label: 'sortBySmart' | 'sortByUpdate' | 'sortByCategory' | 'sortByPinyin'
}> = [
  { id: 'smart', label: 'sortBySmart' },
  { id: 'update', label: 'sortByUpdate' },
  { id: 'category', label: 'sortByCategory' },
  { id: 'pinyin', label: 'sortByPinyin' },
]

export function WorkbenchFeedsPanes({
  pane,
  back,
  backToSources,
  backToNotes,
  admin,
  canRefreshSources,
  onRefreshSources,
  onPane,
}: {
  pane: WorkbenchPane
  back: ReactNode
  backToSources: ReactNode
  backToNotes: ReactNode
  admin?: ReactNode
  canRefreshSources: boolean
  onRefreshSources: () => void | Promise<unknown>
  onPane: (pane: WorkbenchPane) => void
}) {
  const { t } = useI18n()
  const phantasi = t.phantasi
  const { catalog: g, bindGuide } = usePhantasiGuides()
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceRefreshing, setSourceRefreshing] = useState(false)
  const [categoryQuery, setCategoryQuery] = useState('')
  const [opened, setOpened] = useState<string | null>(null)
  const { isAdmin } = useAuth()
  const { preferences, isLoading } = useModuleVisibilityPreferences()
  const [savingSort, setSavingSort] = useState(false)
  const savingSortRef = useRef(false)
  const saveDefaultSort = async (mode: SourceSortMode) => {
    if (!isAdmin || isLoading || savingSortRef.current) return
    savingSortRef.current = true
    setSavingSort(true)
    try {
      const current = await fetchModuleVisibilityPreferences()
      const saved = await updateModuleVisibilityPreferences({
        ...current,
        journalSourceSort: mode,
      })
      dispatchModuleVisibilityPreferencesUpdated(saved)
    } catch {
      showToast({ message: t.config.moduleVisibilitySaveFailed, type: 'error' })
    } finally {
      savingSortRef.current = false
      setSavingSort(false)
    }
  }

  useEffect(() => {
    if (pane !== 'sources') setSourceQuery('')
    if (pane !== 'noteCategories' && pane !== 'sourceCategories') {
      setCategoryQuery('')
    }
    if (
      pane !== 'noteCategories' &&
      pane !== 'sourceCategories' &&
      pane !== 'topics'
    ) {
      setOpened(null)
    }
  }, [pane])

  const boundAdmin =
    (pane === 'sources' ||
      pane === 'add' ||
      pane === 'topics' ||
      pane === 'noteCategories' ||
      pane === 'sourceCategories') &&
    isValidElement(admin)
      ? cloneElement(
          admin as ReactElement<{
            query?: string
            refreshingAll?: boolean
            onAdded?: () => void
            openName?: string | null
            onOpen?: (name: string | null) => void
          }>,
          {
            query:
              pane === 'noteCategories' || pane === 'sourceCategories'
                ? categoryQuery
                : sourceQuery,
            refreshingAll: sourceRefreshing,
            onAdded: () => onPane('sources'),
            openName: opened,
            onOpen: setOpened,
          },
        )
      : admin

  const backToList = (
    <button
      type="button"
      className="section-header-back phantasi-workbench__parent-back"
      onClick={() => setOpened(null)}
      aria-label={t.common.back}
    >
      <LuChevronLeft size={18} aria-hidden />
      <span>{t.common.back}</span>
    </button>
  )

  const openedTitle =
    pane === 'topics'
      ? topicDisplayName({ key: opened ?? '' }, phantasi)
      : isFriendLinkCategory(opened)
        ? phantasi.friendLinks
        : isMineCategory(opened)
          ? phantasi.me
          : opened

  return (
    <>
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
                onPick={() => onPane('add')}
              />
              <PageAction
                label={phantasi.topicAggregate}
                description={phantasi.topicAggregate}
                icon={<LuTag />}
                onPick={() => onPane('topics')}
              />
              <PageAction
                label={phantasi.workbenchCategories}
                description={phantasi.category}
                icon={<LuTag />}
                onPick={() => onPane('sourceCategories')}
              />
            </>
          }
        >
          {isAdmin && (
            <SettingItemWrapper
              itemKey="workbench-sort"
              label={phantasi.workbenchDefaultSort}
              layout="horizontal"
              {...bindGuide('workbench.defaultSort', g.defaultSort)}
            >
              <SegmentedControl
                size="sm"
                value={preferences.journalSourceSort}
                disabled={isLoading || savingSort}
                ariaLabel={phantasi.workbenchDefaultSort}
                onChange={(mode) => { void saveDefaultSort(mode) }}
                options={SORTS.map((item) => ({
                  value: item.id,
                  label: phantasi[item.label],
                }))}
              />
            </SettingItemWrapper>
          )}
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

      {pane === 'topics' ? (
        <WorkbenchPage
          title={opened ? openedTitle || phantasi.topicAggregate : phantasi.topicAggregate}
          icon={<LuTag />}
          back={opened ? backToList : backToSources}
          {...bindGuide('workbench.topics', g.topics)}
        >
          {boundAdmin}
        </WorkbenchPage>
      ) : null}

      {pane === 'noteCategories' || pane === 'sourceCategories' ? (
        <WorkbenchPage
          title={opened ? openedTitle || phantasi.workbenchCategories : phantasi.workbenchCategories}
          icon={<LuTag />}
          {...bindGuide(
            pane === 'noteCategories'
              ? 'workbench.noteCategories'
              : 'workbench.sourceCategories',
            pane === 'noteCategories' ? g.noteCategories : g.sourceCategories,
          )}
          back={
            opened
              ? backToList
              : pane === 'noteCategories'
                ? backToNotes
                : backToSources
          }
          search={
            opened ? undefined : (
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
            )
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
    </>
  )
}
