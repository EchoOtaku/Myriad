/** skin 不进口。 */

import type { PhantasiSource } from '../../types/phantasi'

import { useCallback, useState } from 'react'
import { showPhantasiError } from './phantasiNotice'

export function useBoardEdit(
  filtered: PhantasiSource[],
  onRemoveSources: ((ids: number[]) => Promise<void>) | undefined,
  onRefreshSource: (sourceId: number) => void,
  deleteFailed: string,
  refreshFailed: string,
) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isEditMode, setIsEditMode] = useState(false)
  const [boardEdit, setBoardEdit] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [sourceEditTick, setSourceEditTick] = useState(0)

  const handleToggleSelect = useCallback((sourceId: number) => {
    setSelectedIds((prev) => prev.symmetricDifference(new Set([sourceId])))
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === filtered.length
        ? new Set()
        : new Set(filtered.map((source) => source.id)),
    )
  }, [filtered])

  const handleEnterEditMode = useCallback(() => {
    setIsEditMode(true)
    setBoardEdit(true)
  }, [])
  const handleExitEditMode = useCallback(() => {
    setIsEditMode(false)
    setBoardEdit(false)
    setSelectedIds(new Set())
  }, [])

  const handleOpenSourceEdit = useCallback((source: PhantasiSource) => {
    setSelectedIds(new Set([source.id]))
    setIsEditMode(true)
    setBoardEdit(true)
    setSourceEditTick((tick) => tick + 1)
  }, [])

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0 || !onRemoveSources) return
    const ids = Iterator.from(selectedIds).toArray()
    setIsDeleting(true)
    try {
      await onRemoveSources?.(ids)
      setSelectedIds(new Set())
    } catch (err) {
      await showPhantasiError(err, deleteFailed)
    } finally {
      setIsDeleting(false)
    }
  }, [selectedIds, onRemoveSources, deleteFailed])

  const handleBatchRefresh = useCallback(async () => {
    const refreshable = filtered.filter(
      (source) => source.source_type !== 'link',
    )
    if (refreshable.length === 0) return
    setIsRefreshing(true)
    try {
      await Promise.all(refreshable.map((source) => onRefreshSource(source.id)))
    } catch (err) {
      await showPhantasiError(err, refreshFailed)
    } finally {
      setIsRefreshing(false)
    }
  }, [filtered, onRefreshSource, refreshFailed])

  return {
    selectedIds,
    isEditMode,
    boardEdit,
    isDeleting,
    isRefreshing,
    sourceEditTick,
    handleToggleSelect,
    handleSelectAll,
    handleEnterEditMode,
    handleExitEditMode,
    handleOpenSourceEdit,
    handleBatchDelete,
    handleBatchRefresh,
  }
}
