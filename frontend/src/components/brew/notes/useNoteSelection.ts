/**
 * 监听写栏 / 可视层：选中了字给浮动条锚点，光标停在空行给行槛「+」锚点，
 * 光标落在表格 / 代码块里给块工具条锚点。
 * `hold` 为真时锚点冻住，焦点挪到菜单或输入框上也不消失。
 */

import type { RefObject } from 'react'
import type { NoteEditorPane } from './NoteEditorChrome'
import type { SelectionAnchor, VisualBlockKind } from './noteSelection'
import { useEffect, useState } from 'react'
import {
  anchorInContainer,
  textareaEmptyLineRect,
  textareaSelectionRect,
  visualBlockRect,
  visualEmptyLineRect,
  visualSelectionRect,
} from './noteSelection'

export interface NoteSelectionState {
  selection: SelectionAnchor | null
  emptyLine: SelectionAnchor | null
  block: { kind: VisualBlockKind; anchor: SelectionAnchor } | null
}

const EMPTY: NoteSelectionState = { selection: null, emptyLine: null, block: null }

export function useNoteSelection(
  pane: NoteEditorPane,
  scrollRef: RefObject<HTMLElement | null>,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  visualRef: RefObject<HTMLElement | null>,
  active: boolean,
  hold: boolean,
): NoteSelectionState {
  const [state, setState] = useState<NoteSelectionState>(EMPTY)

  useEffect(() => {
    if (!active || pane === 'preview') {
      setState(EMPTY)
      return
    }
    if (hold) return
    const container = scrollRef.current
    const textarea = textareaRef.current
    const visual = visualRef.current
    if (!container) return
    let frame = 0
    const measure = () => {
      let selection: DOMRect | null = null
      let emptyLine: DOMRect | null = null
      let block: { kind: VisualBlockKind; rect: DOMRect } | null = null
      if (pane === 'visual') {
        if (visual && document.activeElement === visual) {
          selection = visualSelectionRect(visual)
          emptyLine = visualEmptyLineRect(visual)
          block = visualBlockRect(visual)
        }
      } else if (textarea && document.activeElement === textarea) {
        selection = textareaSelectionRect(textarea)
        emptyLine = textareaEmptyLineRect(textarea)
      }
      setState({
        selection: selection ? anchorInContainer(selection, container) : null,
        emptyLine: emptyLine ? anchorInContainer(emptyLine, container) : null,
        block: block
          ? { kind: block.kind, anchor: anchorInContainer(block.rect, container) }
          : null,
      })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const hide = () => {
      cancelAnimationFrame(frame)
      setState(EMPTY)
    }
    const editor: HTMLElement | null = pane === 'visual' ? visual : textarea
    document.addEventListener('selectionchange', schedule)
    window.addEventListener('resize', schedule)
    editor?.addEventListener('input', schedule)
    editor?.addEventListener('keyup', schedule)
    editor?.addEventListener('mouseup', schedule)
    editor?.addEventListener('focus', schedule)
    editor?.addEventListener('blur', hide)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', schedule)
      window.removeEventListener('resize', schedule)
      editor?.removeEventListener('input', schedule)
      editor?.removeEventListener('keyup', schedule)
      editor?.removeEventListener('mouseup', schedule)
      editor?.removeEventListener('focus', schedule)
      editor?.removeEventListener('blur', hide)
    }
  }, [pane, active, hold, scrollRef, textareaRef, visualRef])

  return state
}
