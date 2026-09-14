/** 列表多选：勾选、全选、按当前可见项收口。 */

export function toggleSelectedId<T>(current: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function isAllSelected<T>(
  current: ReadonlySet<T>,
  ids: readonly T[],
): boolean {
  return (
    ids.length > 0 &&
    current.size === ids.length &&
    ids.every((id) => current.has(id))
  )
}

export function nextSelectAllIds<T>(
  current: ReadonlySet<T>,
  ids: readonly T[],
): Set<T> {
  return isAllSelected(current, ids) ? new Set() : new Set(ids)
}

export function pruneSelectedIds<T>(
  current: ReadonlySet<T>,
  allowed: ReadonlySet<T>,
): Set<T> {
  let dropped = false
  const next = new Set<T>()
  for (const id of current) {
    if (allowed.has(id)) next.add(id)
    else dropped = true
  }
  return dropped ? next : (current as Set<T>)
}
