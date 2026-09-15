/** 预览与发布仍走后端渲染。可视层只改 Markdown 原文。 */

import type { NoteEditorProps } from './useNoteEditorSession'
import { NoteEditorView } from './NoteEditorView'
import { useNoteEditorSession } from './useNoteEditorSession'

export default function NoteEditor(props: NoteEditorProps) {
  const session = useNoteEditorSession(props)
  return <NoteEditorView {...session} />
}
