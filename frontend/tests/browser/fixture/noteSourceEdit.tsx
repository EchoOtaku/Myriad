import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  insertPastedMarkdown,
  pastedClipboardToMarkdown,
} from '../../../src/components/phantasi/notes/notePaste'
import { applyNoteSourceEdit } from '../../../src/components/phantasi/notes/noteSourceEdit'

function Editor() {
  const [value, setValue] = useState('')
  return (
    <textarea
      aria-label="Source"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onPaste={(event) => {
        const markdown = pastedClipboardToMarkdown(
          event.clipboardData.getData('text/html'),
          event.clipboardData.getData('text/plain'),
        )
        if (!markdown) return
        event.preventDefault()
        const el = event.currentTarget
        applyNoteSourceEdit(
          el,
          insertPastedMarkdown(
            el.value,
            el.selectionStart,
            el.selectionEnd,
            markdown,
          ),
          setValue,
        )
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Editor />)
