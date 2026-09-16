export interface NoteSourceEdit {
  value: string
  selectionStart: number
  selectionEnd: number
}

export function applyNoteSourceEdit(
  el: HTMLTextAreaElement,
  result: NoteSourceEdit,
  setContent: (value: string) => void,
) {
  const previous = el.value
  if (previous !== result.value) {
    // 只替换变化的区间，并通过原生编辑命令入栈；直接设置 value 会绕过撤销历史。
    let start = 0
    while (
      start < previous.length &&
      start < result.value.length &&
      previous[start] === result.value[start]
    ) {
      start++
}
    let end = previous.length
    let nextEnd = result.value.length
    while (
      end > start &&
      nextEnd > start &&
      previous[end - 1] === result.value[nextEnd - 1]
    ) {
      end--
      nextEnd--
    }
    el.focus()
    el.setSelectionRange(start, end)
    el.ownerDocument.execCommand(
      'insertText',
      false,
      result.value.slice(start, nextEnd),
    )
  }
  setContent(result.value)
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(result.selectionStart, result.selectionEnd)
  })
}
