/** 批量加入分类。皮和管理面都能用，不进口 manager / skin。 */

import { LuTag } from '@lib/icons'
import { useMemo, useState } from 'react'
import { SettingTitleSelect } from '../settings'

export function BatchCategoryPick({
  names,
  disabled = false,
  placeholder,
  searchPlaceholder,
  emptyText,
  labelFor,
  onPick,
}: {
  names: readonly string[]
  disabled?: boolean
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  labelFor?: (name: string) => string
  onPick: (name: string) => void
}) {
  const [value, setValue] = useState('')
  const options = useMemo(
    () => [
      { value: '', label: placeholder },
      ...names.map((name) => ({
        value: name,
        label: labelFor?.(name) ?? name,
      })),
    ],
    [labelFor, names, placeholder],
  )

  return (
    <SettingTitleSelect
      variant="title"
      icon={<LuTag />}
      searchable
      disabled={disabled}
      value={value}
      options={options}
      aria-label={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptySearchText={emptyText}
      className="managed-list-filter-pick"
      onChange={(next) => {
        setValue('')
        if (next) onPick(next)
      }}
    />
  )
}
