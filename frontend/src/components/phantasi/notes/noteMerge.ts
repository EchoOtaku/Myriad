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

interface Hunk {
  start: number
  end: number
  lines: string[]
}

// Trim equal edges before allocating LCS. Large changed regions stay one conservative
// conflict instead of allocating a document-sized quadratic matrix.
const MAX_DIFF_CELLS = 1_000_000
function diffHunks(base: string[], next: string[]): Hunk[] {
  let start = 0
  while (start < base.length && start < next.length && base[start] === next[start]) start++
  let end = base.length
  let nextEnd = next.length
  while (end > start && nextEnd > start && base[end - 1] === next[nextEnd - 1]) { end--; nextEnd-- }
  const n = end - start
  const m = nextEnd - start
  if (!n && !m) return []
  if (!n || !m || (n + 1) * (m + 1) > MAX_DIFF_CELLS) {
    return [{ start, end, lines: next.slice(start, nextEnd) }]
  }
  const width = m + 1
  const scores = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      scores[i * width + j] = base[start + i] === next[start + j]
        ? 1 + scores[(i + 1) * width + j + 1]!
        : Math.max(scores[(i + 1) * width + j]!, scores[i * width + j + 1]!)
    }
  }
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && base[start + i] === next[start + j]) { i++; j++; continue }
    const hunk: Hunk = { start: start + i, end: start + i, lines: [] }
    while (i < n || j < m) {
      if (i < n && j < m && base[start + i] === next[start + j]) break
      if (j < m && (i === n || scores[i * width + j + 1]! > scores[(i + 1) * width + j]!)) {
        hunk.lines.push(next[start + j++]!)
      } else { i++ }
    }
    hunk.end = start + i
    hunks.push(hunk)
  }
  return hunks
}

function applyHunks(base: string[], start: number, end: number, hunks: Hunk[]): string[] {
  const out: string[] = []
  let cursor = start
  for (const hunk of hunks) {
    out.push(...base.slice(cursor, hunk.start), ...hunk.lines)
    cursor = hunk.end
  }
  out.push(...base.slice(cursor, end))
  return out
}

function mergeLines(base: string[], local: string[], remote: string[]): string[] {
  const changes = [
    ...diffHunks(base, local).map((hunk) => ({ ...hunk, side: 0 })),
    ...diffHunks(base, remote).map((hunk) => ({ ...hunk, side: 1 })),
  ].sort((a, b) => a.start - b.start || a.end - b.end || a.side - b.side)
  const out: string[] = []
  let cursor = 0
  for (let i = 0; i < changes.length;) {
    const first = changes[i++]!
    const group = [first]
    let end = first.end
    // Boundary insertions are independent; insertions inside a replaced range conflict.
    while (i < changes.length && (changes[i]!.start < end ||
      (end === first.start && changes[i]!.start === end && changes[i]!.end === end))) {
      const hunk = changes[i++]!
      group.push(hunk)
      end = Math.max(end, hunk.end)
    }
    out.push(...base.slice(cursor, first.start))
    const left = group.filter((hunk) => hunk.side === 0)
    const right = group.filter((hunk) => hunk.side === 1)
    if (!left.length || !right.length) out.push(...applyHunks(base, first.start, end, group))
    else out.push(...mergeInserts(applyHunks(base, first.start, end, left), applyHunks(base, first.start, end, right)))
    cursor = end
  }
  out.push(...base.slice(cursor))
  return out
}

function mergeInserts(local: string[], remote: string[]): string[] {
  if (local.length === remote.length && local.every((line, i) => line === remote[i])) {
    return local
  }
  // Only whole identical edits coalesce; repeated lines inside either edit are intentional.
  return [...local, ...remote]
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
