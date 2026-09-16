import type { ChangeEvent, RefObject } from 'react'
import type { PhantasiSource, UpdateSourceRequest } from '../../../types/phantasi'
import type { SortMode } from './modes'
import type { ImportProgress } from './modes/types'

import {
  LuCheck as Check,
  LuCheckCircle as CheckCircle,
  LuCheckSquare as CheckSquare,
  LuDownload as Download,
  LuEdit3 as Edit3,
  LuLink as Link,
  LuMinusSquare as MinusSquare,
  LuNotebookPen as NotebookPen,
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
import { PhantasiBarMenu, PhantasiBarMenuItem, PhantasiBarWrap, PhantasiMark } from '../ui/Bar'
import { ApplyFriendMode } from './modes/ApplyFriendMode'
import { EditSourceMode } from './modes/EditSourceMode'
import { buildPhantasiSortOptions } from './modes/sortOptions'

const TAG = 'phantasi-feeds__title-tag'

export function PhantasiSourceTitleTags({
  kind = 'feeds',
  showApply = false,
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
  onPhantasiExport,
  onPhantasiImportFile,
  phantasiExportInputRef,
}: {
  kind?: 'feeds' | 'salon'
  showApply?: boolean
  sortMode: SortMode
  onSortModeChange?: (mode: SortMode) => void
  isAdmin?: boolean
  isAuthenticated?: boolean
  canEdit?: boolean
  editing?: boolean
  selectedIds?: Set<number>
  sources?: PhantasiSource[]
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
  onPhantasiExport?: () => void
  onPhantasiImportFile?: (event: ChangeEvent<HTMLInputElement>) => void
  phantasiExportInputRef?: RefObject<HTMLInputElement | null>
}) {
  const salon = kind === 'salon'
  const { t } = useI18n()
  const phantasi = t.phantasi
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const editGuideRef = useRef<{ open: boolean; toggle: () => void } | null>(
    null,
  )
  const options = useMemo(() => buildPhantasiSortOptions(), [])
  const current =
    options.find((option) => option.value === sortMode) ?? options[0]
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
            allOn ? <CheckSquare /> : picked > 0 ? <MinusSquare /> : <Square />
          }
          title={allOn ? phantasi.deselectAll : phantasi.selectAll}
          onClick={onSelectAll}
        >
          {allOn ? phantasi.deselectAll : phantasi.selectAll}
        </SettingTitleTag>
        <SettingTitleTag className={TAG} variant="muted">
          {picked}/{total}
        </SettingTitleTag>
        {selectedSource && onUpdateSource ? (
          <SettingTitleGuideEntry
            title={phantasi.editSource}
            requireShowDetails={false}
            panelClassName="phantasi-feeds__add-guide"
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
                  title={phantasi.editSource}
                  onClick={() => api.toggle()}
                >
                  {phantasi.editThisSource}
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
          title={phantasi.deleteSelected}
          onClick={onBatchDelete}
        >
          {phantasi.deleteSelected}
        </SettingTitleTag>
        {!salon && refreshableCount > 0 ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={
              isRefreshing ? (
                <Spinner size="sm" color="current" />
              ) : (
                <RefreshCw />
              )
            }
            disabled={isRefreshing}
            title={phantasi.refreshAllSources}
            onClick={onBatchRefresh}
          >
            {phantasi.refreshAllSources}
          </SettingTitleTag>
        ) : null}
        {!salon && isAuthenticated && onMarkAllRead ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={<CheckCircle />}
            title={phantasi.markAllAsRead}
            onClick={onMarkAllRead}
          >
            {phantasi.markAllAsRead}
          </SettingTitleTag>
        ) : null}
        {!salon && onPhantasiExport ? (
          <SettingTitleTag
            className={TAG}
            variant="muted"
            icon={<Download />}
            disabled={importExportLoading || total === 0}
            title={phantasi.exportPipack}
            onClick={onPhantasiExport}
          >
            {phantasi.exportPipack}
          </SettingTitleTag>
        ) : null}
        {!salon && onPhantasiImportFile ? (
          <>
            <SettingTitleTag
              className={TAG}
              variant="muted"
              icon={<Upload />}
              disabled={importExportLoading}
              title={phantasi.importPipack}
              onClick={() => phantasiExportInputRef?.current?.click()}
            >
              {phantasi.importPipack}
            </SettingTitleTag>
            <input
              ref={phantasiExportInputRef}
              type="file"
              accept=".pipack,.zip"
              className="phantasi-feeds__title-file"
              disabled={importExportLoading}
              onChange={onPhantasiImportFile}
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
          title={phantasi.exitEdit}
          onClick={onExitEdit}
        >
          {phantasi.exitEdit}
        </SettingTitleTag>
      </>
    )
  }

  return (
    <>
      {!salon ? (
        <PhantasiBarWrap wrapRef={menuRef}>
          <SettingTitleTag
            className={TAG}
            variant={open ? 'default' : 'muted'}
            icon={current.icon}
            title={phantasi.sortMethod}
            onClick={() => setOpen((next) => !next)}
          >
            {phantasi[current.labelKey] || phantasi.sortMethod}
          </SettingTitleTag>
          {open ? (
            <PhantasiBarMenu>
              {options.map((option) => {
                const on = sortMode === option.value
                return (
                  <PhantasiBarMenuItem
                    key={option.value}
                    on={on}
                    onClick={() => {
                      onSortModeChange?.(option.value)
                      setOpen(false)
                    }}
                  >
                    <PhantasiMark>{option.icon}</PhantasiMark>
                    <span className="phantasi-bar__label">
                      {phantasi[option.labelKey]}
                    </span>
                    {on ? (
                      <PhantasiMark>
                        <Check />
                      </PhantasiMark>
                    ) : null}
                  </PhantasiBarMenuItem>
                )
              })}
            </PhantasiBarMenu>
          ) : null}
        </PhantasiBarWrap>
      ) : null}
      {showApply ? (
        <SettingTitleGuideEntry
          title={phantasi.applyFriendLink}
          requireShowDetails={false}
          panelClassName="phantasi-feeds__add-guide"
          keepMounted
          guide={<ApplyFriendMode />}
          renderTrigger={(api) => (
            <SettingTitleTag
              className={TAG}
              variant={api.open ? 'default' : 'muted'}
              icon={<Link />}
              title={phantasi.applyFriendLink}
              onClick={() => api.toggle()}
            >
              {phantasi.applyFriendLink}
            </SettingTitleTag>
          )}
        />
      ) : null}
      {onWriteNote ? (
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<NotebookPen />}
          title={phantasi.noteWrite}
          onClick={onWriteNote}
        >
          {phantasi.noteWrite}
        </SettingTitleTag>
      ) : null}
      {isAdmin && onEnterEdit && (!salon || total > 0) ? (
        <SettingTitleTag
          className={TAG}
          variant="muted"
          icon={<Edit3 />}
          disabled={!canEdit}
          title={phantasi.editMode}
          onClick={onEnterEdit}
        >
          {phantasi.edit}
        </SettingTitleTag>
      ) : null}
    </>
  )
}
