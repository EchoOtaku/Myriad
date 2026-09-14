/** 批量加入分类。皮和管理面都能用，不进口 manager / skin。 */

import { useMemo, useState } from 'react'
import { FieldSelect } from '../settings'

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
    <FieldSelect
      size="sm"
      searchable
      disabled={disabled}
      value={value}
      options={options}
      aria-label={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptySearchText={emptyText}
      onChange={(next) => {
        setValue('')
        if (next) onPick(next)
      }}
    />
  )
}
