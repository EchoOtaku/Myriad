/** 和后端 `merge_text` 同一口径：不同行能合，同一行两边都改则两行都留。 */

export function mergeNoteText(base: string, local: string, remote: string): string {
  if (local === remote || remote === base) return local
  if (local === base) return remote
  return mergeLines(splitLines(base), splitLines(local), splitLines(remote)).join(
    '\n',
  )
}

export function mergeNoteField(
  base: string | null,
  local: string | null,
  remote: string | null,
): string | null {
  if (local === remote || remote === base) return local
  if (local === base) return remote
  return local ?? remote
}

function splitLines(text: string): string[] {
  if (!text) return []
  return text.split('\n')
}

function firstIndex(lines: string[], start: number, needle: string): number {
  return lines.indexOf(needle, start)
}

function nextShared(
  base: string[],
  from: number,
  other: string[],
  otherStart: number,
): number {
  for (const line of base.slice(from)) {
    const index = firstIndex(other, otherStart, line)
    if (index >= 0) return index
  }
  return other.length
}

function mergeLines(base: string[], local: string[], remote: string[]): string[] {
  const out: string[] = []
  let li = 0
  let ri = 0
  let bi = 0
  while (bi < base.length) {
    const line = base[bi]
    const localAt = firstIndex(local, li, line)
    const remoteAt = firstIndex(remote, ri, line)
    if (localAt >= 0 && remoteAt >= 0) {
      out.push(...mergeInserts(local.slice(li, localAt), remote.slice(ri, remoteAt)))
      out.push(line)
      li = localAt + 1
      ri = remoteAt + 1
      bi += 1
      continue
    }
    if (localAt < 0 && remoteAt >= 0) {
      const end = nextShared(base, bi + 1, local, li)
      out.push(...local.slice(li, end))
      li = end
      ri = remoteAt + 1
      bi += 1
      continue
    }
    if (localAt >= 0 && remoteAt < 0) {
      const end = nextShared(base, bi + 1, remote, ri)
      out.push(...remote.slice(ri, end))
      ri = end
      li = localAt + 1
      bi += 1
      continue
    }
    const localEnd = nextShared(base, bi + 1, local, li)
    const remoteEnd = nextShared(base, bi + 1, remote, ri)
    out.push(...mergeInserts(local.slice(li, localEnd), remote.slice(ri, remoteEnd)))
    li = localEnd
    ri = remoteEnd
    bi += 1
  }
  out.push(...mergeInserts(local.slice(li), remote.slice(ri)))
  return out
}

function mergeInserts(local: string[], remote: string[]): string[] {
  if (local.length === remote.length && local.every((line, i) => line === remote[i])) {
    return local
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of [...local, ...remote]) {
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

export function caretOffsetStyle(
  text: string,
  cursor: number,
): { top: string; left: string } {
  const before = text.slice(0, Math.max(0, cursor))
  const lines = before.split('\n')
  const row = Math.max(0, lines.length - 1)
  const col = lines[row]?.length ?? 0
  const lineHeight = 15.4
  const pad = 16
  const ch = 8.4
  return {
    top: `${pad + row * lineHeight}px`,
    left: `${pad + col * ch}px`,
  }
}
