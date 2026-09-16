interface Endpoint {
  index: number
  text: string
  offset: number
}

interface NoteSelection {
  blocks: string[]
  anchor: Endpoint
  focus: Endpoint
}

/** Capture only an active editor's selection; background updates must not focus it. */
export function captureNoteSelection(root: HTMLElement): NoteSelection | null {
  const doc = root.ownerDocument
  if (doc.activeElement !== root && !root.contains(doc.activeElement)) return null
  const selection = doc.getSelection()
  if (!selection?.anchorNode || !selection.focusNode) return null
  const blocks = Array.from(root.childNodes)
  const endpoint = (node: Node, offset: number): Endpoint | null => {
    if (node !== root && !root.contains(node)) return null
    let block = node
    if (node === root) { block = blocks[Math.min(offset, blocks.length - 1)]
}
    else { while (block.parentNode !== root) block = block.parentNode!
}
    if (!block) return null
    const range = doc.createRange()
    range.selectNodeContents(block)
    if (node === root) range.collapse(offset < blocks.length)
    else range.setEnd(node, offset)
    return { index: blocks.indexOf(block), text: block.textContent ?? '', offset: range.toString().length }
  }
  const anchor = endpoint(selection.anchorNode, selection.anchorOffset)
  const focus = endpoint(selection.focusNode, selection.focusOffset)
  return anchor && focus ? { blocks: blocks.map(block => block.textContent ?? ''), anchor, focus } : null
}

function sharedEdges(before: string, after: string) {
  let prefix = 0
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < Math.min(before.length, after.length) - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) { suffix++
}
  return { prefix, suffix }
}

/** Restore anchor and focus separately, retaining backwards selections. */
export function restoreNoteSelection(root: HTMLElement, saved: NoteSelection | null): void {
  if (!saved) return
  const doc = root.ownerDocument
  if (doc.activeElement !== root && !root.contains(doc.activeElement)) return
  const blocks = Array.from(root.childNodes)
  if (!blocks.length) return
  const locate = (point: Endpoint): [Node, number] => {
    const exact = blocks.map((block, index) => ({ block, index }))
      .filter(({ block }) => block.textContent === point.text)
      .sort((a, b) => Math.abs(a.index - point.index) - Math.abs(b.index - point.index))
    let index = exact[0]?.index ?? Math.min(point.index, blocks.length - 1)
    if (!exact.length) {
      let best = -Infinity
      blocks.forEach((block, candidate) => {
        const text = block.textContent ?? ''
        const { prefix, suffix } = sharedEdges(point.text, text)
        const previous = point.index > 0 && candidate > 0 && saved.blocks[point.index - 1] === blocks[candidate - 1].textContent
        const next = point.index + 1 < saved.blocks.length && candidate + 1 < blocks.length && saved.blocks[point.index + 1] === blocks[candidate + 1].textContent
        const score = (prefix + suffix) / Math.max(point.text.length, text.length, 1)
          + Number(previous) + Number(next) - Math.abs(candidate - point.index) * 0.001
        if (score > best) { best = score; index = candidate }
      })
    }
    const block = blocks[index]
    const text = block.textContent ?? ''
    const { prefix, suffix } = sharedEdges(point.text, text)
    let offset = point.offset <= prefix ? point.offset
      : point.offset >= point.text.length - suffix ? text.length - (point.text.length - point.offset)
        : prefix + Math.min(point.offset - prefix, text.length - prefix - suffix)
    offset = Math.max(0, Math.min(offset, text.length))
    if (block.nodeType === 3) return [block, offset]
    const walker = doc.createTreeWalker(block, 4 /* SHOW_TEXT */)
    let node = walker.nextNode()
    while (node) {
      const length = node.textContent?.length ?? 0
      if (offset <= length) return [node, offset]
      offset -= length
      node = walker.nextNode()
    }
    return [block, block.childNodes.length]
  }
  const [anchor, anchorOffset] = locate(saved.anchor)
  const [focus, focusOffset] = locate(saved.focus)
  doc.getSelection()?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
}
