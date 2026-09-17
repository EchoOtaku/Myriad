import type { MutableRefObject, RefObject } from 'react'
import { useCallback, useEffect } from 'react'
import {
  markdownToVisualHtml,
  runVisualCommand,
} from './noteVisual'
import { trimVisualHistory } from './noteVisualHistory'
import { replaceNoteHtml } from './noteWidgetMount'
import { hydrateVisualMath } from './renderMath'

export const VISUAL_UNDO_GROUP_MS = 600
export { VISUAL_UNDO_LIMIT } from './noteVisualHistory'

export interface NoteVisualHistory {
  past: string[]
  future: string[]
  lastPush: number
  recorded: string
  restoring: boolean
}

export function useNoteVisual({
  visualRef,
  visualEditing,
  historyRef,
  contentMd,
  contentMdRef,
  pane,
  paneRef,
  loading,
  setContentMd,
}: {
  visualRef: RefObject<HTMLDivElement | null>
  visualEditing: MutableRefObject<boolean>
  historyRef: MutableRefObject<NoteVisualHistory>
  contentMd: string
  contentMdRef: MutableRefObject<string>
  pane: string
  paneRef: MutableRefObject<string>
  loading: boolean
  setContentMd: (next: string) => void
}) {
  useEffect(() => {
    const history = historyRef.current
    if (pane !== 'visual' || loading) {
      history.recorded = contentMd
      return
    }
    if (history.restoring) {
      history.restoring = false
      history.recorded = contentMd
      return
    }
    if (contentMd === history.recorded) return
    const now = Date.now()
    if (now - history.lastPush > VISUAL_UNDO_GROUP_MS || history.past.length === 0) {
      history.past.push(history.recorded)
      history.future = []
      trimVisualHistory(history)
    }
    history.lastPush = now
    history.recorded = contentMd
  }, [contentMd, historyRef, loading, pane])

  const syncVisualFromMarkdown = useCallback((next: string) => {
    setContentMd(next)
    const el = visualRef.current
    if (paneRef.current === 'visual' && el) {
      replaceNoteHtml(el, markdownToVisualHtml(next))
      hydrateVisualMath(el)
      el.dataset.noteVisual = next
    }
  }, [paneRef, setContentMd, visualRef])

  const commitVisualMd = useCallback((next: string) => {
    visualEditing.current = true
    setContentMd(next)
  }, [setContentMd, visualEditing])

  const runVisual = useCallback((command: string, value?: string) => {
    const root = visualRef.current
    if (!root) return
    commitVisualMd(runVisualCommand(root, command, value))
  }, [commitVisualMd, visualRef])

  const visualHistoryStep = useCallback(
    (direction: 'undo' | 'redo') => {
      const history = historyRef.current
      const from = direction === 'undo' ? history.past : history.future
      const to = direction === 'undo' ? history.future : history.past
      const next = from.pop()
      if (next === undefined) return
      to.push(contentMdRef.current)
      trimVisualHistory(history)
      history.restoring = true
      history.lastPush = 0
      syncVisualFromMarkdown(next)
      const root = visualRef.current
      if (root) {
        root.focus()
        const range = document.createRange()
        range.selectNodeContents(root)
        range.collapse(false)
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    },
    [contentMdRef, historyRef, syncVisualFromMarkdown, visualRef],
  )

  return {
    syncVisualFromMarkdown,
    commitVisualMd,
    runVisual,
    visualHistoryStep,
  }
}
