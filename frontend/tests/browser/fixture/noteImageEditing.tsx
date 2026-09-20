import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NoteBlockBar } from '../../../src/components/phantasi/notes/NoteEditorChrome'
import { anchorInContainer } from '../../../src/components/phantasi/notes/noteSelection'
import { markdownToVisualHtml, setImageAlt, setImageLink, setImageSrc } from '../../../src/components/phantasi/notes/noteVisual'
import { useNoteVisual } from '../../../src/components/phantasi/notes/useNoteVisual'
import { I18nNamespace, I18nProvider } from '../../../src/contexts/I18nContext'
import '../../../src/styles/tailwind.css'
import '../../../src/styles/theme.css'
import '../../../src/styles/overrides.css'
import '../../../src/components/phantasi/ui/phantasi.css'
import '../../../src/components/phantasi/notes/NoteEditor.css'

const initial = '[![Cover](/note-editor-cover.svg)](https://example.test/old)'
const initialHtml = markdownToVisualHtml(initial)
function Harness() {
  const [md, setMd] = useState(initial)
  const [selected, setSelected] = useState<HTMLImageElement | null>(null)
  const visualRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const visualEditing = useRef(false)
  const contentMdRef = useRef(md)
  contentMdRef.current = md
  const paneRef = useRef('visual')
  const historyRef = useRef({ past: [] as string[], future: [] as string[], lastPush: 0, recorded: initial, restoring: false })
  const { commitVisualMd, visualHistoryStep } = useNoteVisual({ visualRef, visualEditing, historyRef, contentMd: md, contentMdRef, pane: 'visual', paneRef, loading: false, setContentMd: setMd })
  const noOp = () => {}
  return <div className="phantasi-skin phantasi-note">
    <div className="phantasi-note__frame">
      <div className="phantasi-note__scroll" ref={scrollRef}>
        <article className="phantasi-note__paper" style={{ paddingTop: 100 }}>
          <h1>Image editing</h1>
          <div
            className="phantasi-note-preview phantasi-note__visual"
            ref={visualRef}
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: initialHtml }}
            onClick={event => {
              if ((event.target as HTMLElement).closest('a')) event.preventDefault()
              setSelected(event.target instanceof HTMLImageElement ? event.target : null)
            }}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
                event.preventDefault()
                setSelected(null)
                visualHistoryStep(event.shiftKey ? 'redo' : 'undo')
              }
            }}
          />
          <pre id="markdown" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{md}</pre>
        </article>
        <NoteBlockBar
          block={selected && scrollRef.current ? { kind: 'img', anchor: anchorInContainer(selected.getBoundingClientRect(), scrollRef.current) } : null}
          codeLang=""
          onCodeLangChange={noOp}
          columnAlign={null}
          onTableAlign={noOp}
          onTableAddRow={noOp}
          onTableAddColumn={noOp}
          onTableRemoveRow={noOp}
          onTableRemoveColumn={noOp}
          onTableRemove={noOp}
          imageAlt={selected?.alt ?? ''}
          imageSrc={selected?.getAttribute('src') ?? ''}
          imageHref={selected?.closest('a')?.getAttribute('href') ?? ''}
          onImageApply={values => {
            if (!selected || !visualRef.current) return
            setImageSrc(visualRef.current, selected, values.src)
            setImageLink(visualRef.current, selected, values.href)
            commitVisualMd(setImageAlt(visualRef.current, selected, values.alt))
          }}
          onImageReplace={noOp}
          onImageRemove={noOp}
          onColumnsAdd={noOp}
          onColumnsRemoveCol={noOp}
          onColumnsRemove={noOp}
          widgetSize=""
          widgetSizes={[]}
          onWidgetSize={noOp}
          onWidgetRemove={noOp}
          onFocusChange={noOp}
          barRef={barRef}
        />
      </div>
    </div>
  </div>
}
createRoot(document.getElementById('root')!).render(<I18nProvider><I18nNamespace names={['phantasi']}><Harness /></I18nNamespace></I18nProvider>)
