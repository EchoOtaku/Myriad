import type { ChangeEvent, RefObject } from 'react'
import type { BrewSource, UpdateSourceRequest } from '../../../types/brew'
import type { SortMode } from './modes'
import type { ImportProgress } from './modes/types'

import {
  LuCheck as Check,
  LuCheckCircle as CheckCircle,
  LuCheckSquare as CheckSquare,
  LuDownload as Download,
  LuEdit3 as Edit3,
  LuMinusSquare as MinusSquare,
  LuNotebookPen as NotebookPen,
  LuPlus as Plus,
  LuRefreshCw as RefreshCw,
  LuSquare as Square,
  LuTrash2 as Trash2,
  LuUpload as Upload,
  LuX as X,
} from '@lib/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { SettingTitleGuideEntry } from '../../settings/SettingTitleGuideEntry'
import { SettingTitleTag } from '../../settings/SettingTitleTag'
import { Spinner } from '../../Spinner'
import { BrewBarMenu, BrewBarMenuItem, BrewBarWrap, BrewMark } from '../ui/Bar'
import { useFeedsAddForm } from '../ui/BrewFeedsPanel'
import { EditSourceMode } from './modes/EditSourceMode'
import { buildBrewSortOptions } from './modes/sortOptions'

const TAG = 'brew-feeds__title-tag'

export function BrewSourceTitleTags({
  kind = 'feeds',
  sortMode,
  onSortModeChange,
  isAdmin = false,
  isAuthenticated = false,
  canEdit = true,
  editing = false,
  selectedIds,
  sources,
  categories = [],
  refreshableCount = 0,
  isDeleting = false,
  isRefreshing = false,
  onEnterEdit,
  onExitEdit,
  onSelectAll,
  onBatchDelete,
  onBatchRefresh,
  onMarkAllRead,
  onWriteNote,
  onUpdateSource,
  onDiscover,
  onGenerateStyleTags,
  sourceEditTick = 0,
  importExportLoading = false,
  importProgress,
  onBrewExport,
  onBrewImportFile,
  brewExportInputRef,
}: {
  kind?: 'feeds' | 'salon'
  sortMode: SortMode
  onSortModeChange?: (mode: SortMode) => void
  isAdmin?: boolean
  isAuthenticated?: boolean
  canEdit?: boolean
  editing?: boolean
  selectedIds?: Set<number>
  sources?: BrewSource[]
  categories?: string[]
  refreshableCount?: number
  isDeleting?: boolean
  isRefreshing?: boolean
  onEnterEdit?: () => void
  onExitEdit?: () => void
  onSelectAll?: () => void
  onBatchDelete?: () => void
  onBatchRefresh?: () => void
  onMarkAllRead?: () => void
  onWriteNote?: () => void
  onUpdateSource?: (id: number, data: UpdateSourceRequest) => Promise<void>
  onDiscover?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{
    url: string
    title: string
    feed_type: string
    autocompleted: boolean
  } | null>
  onGenerateStyleTags?: (
    sourceId: number,
    signal?: AbortSignal,
  ) => Promise<{ success: boolean; tags?: string[] }>
  sourceEditTick?: number
  importExportLoading?: boolean
  importProgress?: ImportProgress | null
  onBrewExport?: () => void
  onBrewImportFile?: (event: ChangeEvent<HTMLInputElement>) => void
  brewExportInputRef?: RefObject<HTMLInputElement | null>
}) {
  const salon = kind === 'salon'
  const { t } = useI18n()
  const brew = t.brew
  const addForm = useFeedsAddForm()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const editGuideRef = useRef<{ open: boolean; toggle: () => void } | null>(
    null,
  )
  const options = useMemo(() => buildBrewSortOptions(), [])
  const current = options.find((option) => option.value === sortMode) ?? options[0]
  const total = sources?.length ?? 0
  const picked = selectedIds?.size ?? 0
  const allOn = picked === total && total > 0
  const selectedSource =
    selectedIds?.size === 1
      ? sources?.find((source) => selectedIds.has(source.id))
      : undefined

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  useEffect(() => {
    if (!sourceEditTick) return
    const api = editGuideRef.current
    if (api && !api.open) api.toggle()
  }, [sourceEditTick])

  if (editing) {
    return (
      <>
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={
            allOn ? (
              <CheckSquare />
            ) : picked > 0 ? (
              <MinusSquare />
            ) : (
              <Square />
            )
          }
          title={allOn ? brew.deselectAll : brew.selectAll}
          onClick={onSelectAll}
        >
          {allOn ? brew.deselectAll : brew.selectAll}
        </SettingTitleTag>
        <SettingTitleTag className={TAG} variant="muted">
          {picked}/{total}
        </SettingTitleTag>
        {selectedSource && onUpdateSource ? (
          <SettingTitleGuideEntry
            title={brew.editSource}
            requireShowDetails={false}
            panelClassName="brew-feeds__add-guide"
            keepMounted
            guide={
              <EditSourceMode
                key={selectedSource.id}
                source={selectedSource}
                categories={categories}
                onSave={onUpdateSource}
                onDiscover={onDiscover}
                onGenerateStyleTags={onGenerateStyleTags}
              />
            }
            renderTrigger={(api) => {
              editGuideRef.current = { open: api.open, toggle: api.toggle }
              return (
                <SettingTitleTag
                  className={TAG}
                  variant={api.open ? 'default' : 'muted'}
                  icon={<Edit3 />}
                  title={brew.editSource}
                  onClick={() => api.toggle()}
                >
                  {brew.editThisSource}
                </SettingTitleTag>
              )
            }}
          />
        ) : null}
        <SettingTitleTag
          className={TAG}
          variant="danger"
          icon={<Trash2 />}
          disabled={isDeleting || picked === 0}
          title={brew.deleteSelected}
          onClick={onBatchDelete}
        >
          {brew.deleteSelected}
        </SettingTitleTag>
        {!salon && refreshableCount > 0 ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={
              isRefreshing ? <Spinner size="sm" color="current" /> : <RefreshCw />
            }
            disabled={isRefreshing}
            title={brew.refreshAllSources}
            onClick={onBatchRefresh}
          >
            {brew.refreshAllSources}
          </SettingTitleTag>
        ) : null}
        {!salon && isAuthenticated && onMarkAllRead ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={<CheckCircle />}
            title={brew.markAllAsRead}
            onClick={onMarkAllRead}
          >
            {brew.markAllAsRead}
          </SettingTitleTag>
        ) : null}
        {!salon && onBrewExport ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={<Download />}
            disabled={importExportLoading || total === 0}
            title={brew.exportBrewpack}
            onClick={onBrewExport}
          >
            {brew.exportBrewpack}
          </SettingTitleTag>
        ) : null}
        {!salon && onBrewImportFile ? (
          <>
            <SettingTitleTag
              className={TAG}
              variant="muted"
              icon={<Upload />}
              disabled={importExportLoading}
              title={brew.importBrewpack}
              onClick={() => brewExportInputRef?.current?.click()}
            >
              {brew.importBrewpack}
            </SettingTitleTag>
            <input
              ref={brewExportInputRef}
              type="file"
              accept=".brewpack,.zip"
              className="brew-feeds__title-file"
              disabled={importExportLoading}
              onChange={onBrewImportFile}
            />
          </>
        ) : null}
        {importProgress ? (
          <SettingTitleTag className={TAG} variant="muted">
            {importProgress.step}
            {importProgress.total > 0
              ? ` ${importProgress.current}/${importProgress.total}`
              : ''}
          </SettingTitleTag>
        ) : null}
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<X />}
          title={brew.exitEdit}
          onClick={onExitEdit}
        >
          {brew.exitEdit}
        </SettingTitleTag>
      </>
    )
  }

  return (
    <>
      {!salon ? (
        <BrewBarWrap wrapRef={menuRef}>
          <SettingTitleTag
            className={TAG}
            variant={open ? 'default' : 'muted'}
            icon={current.icon}
            title={brew.sortMethod}
            onClick={() => setOpen((next) => !next)}
          >
            {brew[current.labelKey] || brew.sortMethod}
          </SettingTitleTag>
          {open ? (
            <BrewBarMenu>
              {options.map((option) => {
                const on = sortMode === option.value
                return (
                  <BrewBarMenuItem
                    key={option.value}
                    on={on}
                    onClick={() => {
                      onSortModeChange?.(option.value)
                      setOpen(false)
                    }}
                  >
                    <BrewMark>{option.icon}</BrewMark>
                    <span className="brew-bar__label">
                      {brew[option.labelKey]}
                    </span>
                    {on ? (
                      <BrewMark>
                        <Check />
                      </BrewMark>
                    ) : null}
                  </BrewBarMenuItem>
                )
              })}
            </BrewBarMenu>
          ) : null}
        </BrewBarWrap>
      ) : null}
      {onWriteNote ? (
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<NotebookPen />}
          title={brew.noteWrite}
          onClick={onWriteNote}
        >
          {brew.noteWrite}
        </SettingTitleTag>
      ) : null}
      {!salon && addForm ? (
        <SettingTitleGuideEntry
          title={brew.addSubscription}
          requireShowDetails={false}
          panelClassName="brew-feeds__add-guide"
          keepMounted
          guide={addForm}
          renderTrigger={(api) => (
            <SettingTitleTag
              className={TAG}
              variant={api.open ? 'default' : 'muted'}
              icon={<Plus />}
              onClick={() => api.toggle()}
            >
              {brew.add}
            </SettingTitleTag>
          )}
        />
      ) : null}
      {isAdmin && onEnterEdit && (!salon || total > 0) ? (
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<Edit3 />}
          disabled={!canEdit}
          title={brew.editMode}
          onClick={onEnterEdit}
        >
          {brew.edit}
        </SettingTitleTag>
      ) : null}
    </>
  )
}
