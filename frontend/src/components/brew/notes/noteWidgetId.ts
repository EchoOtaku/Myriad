const instanceIds = new WeakMap<object, string>()
const islandKeys = new WeakMap<object, string>()
let instanceSeq = 0
let islandSeq = 0

/** 同一占位反复读是同一个 id；两张同类型不共用。 */
export function noteWidgetInstanceId(host: object, type: string): string {
  const existing = instanceIds.get(host)
  if (existing) return existing
  const id = `note-${type}-${++instanceSeq}`
  instanceIds.set(host, id)
  return id
}

export function noteWidgetIslandKey(host: object): string {
  const existing = islandKeys.get(host)
  if (existing) return existing
  const key = `nw-${++islandSeq}`
  islandKeys.set(host, key)
  return key
}
