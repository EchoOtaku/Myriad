/** 设置列表的批量选中。皮和管理面共用，不进口 manager / skin。 */

import type { ReactNode } from 'react'
import type {
  ManagedListAction,
  ManagedListStat,
} from '../settings/ManagedList'
import {
  LuCheckSquare,
  LuEdit3,
  LuMinusSquare,
  LuSquare,
  LuTrash2,
  LuX,
} from '@lib/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isAllSelected,
  nextSelectAllIds,
  pruneSelectedIds,
  toggleSelectedId,
} from './logic/listSelect'

export function useListSelection<T extends string | number>(
  ids: readonly T[],
) {
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<T>>(() => new Set())
  const idsRef = useRef(ids)
  idsRef.current = ids

  useEffect(() => {
    const allowed = new Set(ids)
    setSelected((prev) => pruneSelectedIds(prev, allowed))
  }, [ids])

  const enter = useCallback(() => setSelecting(true), [])
  const exit = useCallback(() => {
    setSelecting(false)
    setSelected(new Set())
  }, [])
  const toggle = useCallback((id: T) => {
    setSelected((prev) => toggleSelectedId(prev, id))
  }, [])
  const selectAll = useCallback(() => {
    const current = idsRef.current
    setSelected((prev) => nextSelectAllIds(prev, current))
  }, [])

  return {
    selecting,
    selected,
    picked: selected.size,
    total: ids.length,
    allOn: isAllSelected(selected, ids),
    enter,
    exit,
    toggle,
    selectAll,
  }
}

export function listSelectChrome({
  selecting,
  picked,
  total,
  allOn,
  busy = false,
  labels,
  onEnter,
  onExit,
  onSelectAll,
  onDelete,
}: {
  selecting: boolean
  picked: number
  total: number
  allOn: boolean
  busy?: boolean
  labels: {
    edit: string
    selectAll: string
    deselectAll: string
    deleteSelected: string
    deleteConfirm: string
    exitEdit: string
    selectedLabel: string
  }
  onEnter: () => void
  onExit: () => void
  onSelectAll: () => void
  onDelete: () => void
}): {
  stats: ManagedListStat[] | undefined
  toolbar: ManagedListAction[]
} {
  if (!selecting) {
    return {
      stats: undefined,
      toolbar: [
        {
          key: 'edit',
          slot: 'lead',
          label: labels.edit,
          icon: <LuEdit3 />,
          disabled: total === 0 || busy,
          onClick: onEnter,
        },
      ],
    }
  }

  const selectIcon: ReactNode = allOn ? (
    <LuCheckSquare />
  ) : picked > 0 ? (
    <LuMinusSquare />
  ) : (
    <LuSquare />
  )

  return {
    stats: [
      {
        key: 'picked',
        label: labels.selectedLabel,
        value: `${picked}/${total}`,
      },
    ],
    toolbar: [
      {
        key: 'exit',
        slot: 'lead',
        label: labels.exitEdit,
        icon: <LuX />,
        disabled: busy,
        onClick: onExit,
      },
      {
        key: 'all',
        slot: 'expanded',
        label: allOn ? labels.deselectAll : labels.selectAll,
        icon: selectIcon,
        disabled: total === 0 || busy,
        onClick: onSelectAll,
      },
      {
        key: 'delete',
        slot: 'expanded',
        label: labels.deleteSelected,
        icon: <LuTrash2 />,
        variant: 'danger',
        confirm: labels.deleteConfirm,
        disabled: picked === 0 || busy,
        onClick: onDelete,
      },
    ],
  }
}
