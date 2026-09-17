import type { PhantasiNoteDoc } from '../../../src/types/phantasi'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { readNoteRecovery } from '../../../src/components/phantasi/notes/noteDraft'
import { countNoteChars } from '../../../src/components/phantasi/notes/noteFields'
import { createVisualMarkdownSerializer, visualHtmlToMarkdown, visualMarkdownStamp } from '../../../src/components/phantasi/notes/noteVisual'
import { useNoteCloudSave } from '../../../src/components/phantasi/notes/useNoteCloudSave'
import { useNotePublish } from '../../../src/components/phantasi/notes/useNotePublish'
import { useNoteSelection } from '../../../src/components/phantasi/notes/useNoteSelection'
import { useNoteVisual } from '../../../src/components/phantasi/notes/useNoteVisual'
import { updateNoteDoc } from '../../../src/services/phantasiApi'

const params = new URLSearchParams(location.search)
const shape = params.get('shape') || 'paragraph'
const size = Number(params.get('size')) || 180_000
const text = 'plain text '.repeat(Math.ceil(size / 11)).slice(0, size)
const initialHtml = shape === 'pre' ? `<pre data-lang="text"><code>${text}</code></pre>`
  : shape === 'table' ? `<table><tr><th>Key</th><th>Content</th></tr>${Array.from({ length: 1200 }, (_, i) => `<tr><td>${i}</td><td>${text.slice(0, 110)}</td></tr>`).join('')}</table>`
    : `<p>${text}</p>`
const initial = visualHtmlToMarkdown(initialHtml)
const samples: number[] = []
const commitSamples: number[] = []
const paintSamples: number[] = []
const errors: string[] = []
let saved = ''
let published = false
let start = 0
let writes = 0
const nativeSetItem = Storage.prototype.setItem
Storage.prototype.setItem = function (key: string, value: string) { if (key.startsWith('phantasi:note-draft:')) writes++; nativeSetItem.call(this, key, value) }

function Editor({ docId }: { docId: number }) {
  const [md, setMd] = useState(docId === 1 ? initial : 'Second document')
  const [saving, setSaving] = useState(false)
  const visualRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useNoteSelection('visual', scrollRef, textareaRef, visualRef, true, false)
  const contentMdRef = useRef(md)
  contentMdRef.current = md
  const visualEditing = useRef(false)
  const paneRef = useRef('visual')
  const historyRef = useRef({ past: [] as string[], future: [] as string[], lastPush: 0, recorded: md, restoring: false })
  const revisionRef = useRef(1)
  const [serialize] = useState(createVisualMarkdownSerializer)
  useEffect(() => () => serialize.dispose(), [serialize])
  const visual = useNoteVisual({ visualRef, visualEditing, historyRef, contentMd: md, contentMdRef, pane: 'visual', paneRef, loading: false, setContentMd: setMd })
  const fields = { title: 'Large note', contentMd: md, topic: null, cover: null, publishedAt: null }
  const cloud = useNoteCloudSave({ userId: 1, cloudId: docId, loading: false, fields, revisionRef,
    onServerDoc: () => {}, onMerged: next => setMd(next.contentMd), onSaved: next => { saved = next.contentMd }, onError: error => { if (error) errors.push(error) },
    labels: { saveFailed: 'Save failed', conflict: 'Conflict' },
  })
  const publish = useNotePublish({ ...fields, scheduledAt: null, cloudId: docId, draftKey: null, docStatus: 'draft', saving,
    setSaving, setContentMd: setMd, setPublishedAt: () => {}, revisionRef, runWrite: cloud.runWrite, clearRecovery: cloud.discardRecovery,
    onSaved: () => { published = true }, onClose: () => {}, format: value => value,
    labels: { titleRequired: 'title', titleTooLong: 'title-long', bodyTooLong: 'body-long', saveFailed: 'save', scheduleNeedTime: 'time', schedulePast: 'past', deleteConfirm: 'delete', deleteFailed: 'delete', discardConfirm: 'discard' },
  })
  const chars = useMemo(() => countNoteChars(md), [md])
  useLayoutEffect(() => {
    if (visualRef.current) visualMarkdownStamp.set(visualRef.current, md)
    if (start) { commitSamples.push(performance.now() - start); start = 0 }
  }, [md])
  const save = () => cloud.runWrite(async (latest, track) => {
    const receipt = track(latest)
    const doc: PhantasiNoteDoc = await updateNoteDoc(docId, { title: latest.title, content_md: latest.contentMd, revision: revisionRef.current, client_request_id: receipt.requestId })
    await receipt.receiveDoc(doc)
  })
  Object.assign(window, { noteLarge: {
    snapshot: () => ({ md: contentMdRef.current, saved, published, samples, commitSamples, paintSamples, errors, writes, chars, recovery: readNoteRecovery({ userId: 1, docId: 1 }) }),
    compare: () => {
      const root = visualRef.current!
      const textNode = shape === 'table' ? root.querySelector('td')!.firstChild! : root.querySelector('code')?.firstChild ?? root.querySelector('p')?.firstChild
      const legacy: number[] = []; const current: number[] = []
      for (let i = 0; i < 12; i++) {
        ;(textNode as Text).appendData('x')
        let time = performance.now(); const next = serialize(root); current.push(performance.now() - time)
        time = performance.now(); const old = visualHtmlToMarkdown(root.innerHTML); legacy.push(performance.now() - time)
        if (old !== next) throw new Error('Serializer parity failed')
      }
      visual.commitVisualMd(serialize(root))
      return { legacy, current }
    },
  } })
  return <div ref={scrollRef}>
    <nav style={{ position: 'sticky', top: 0, background: 'white', padding: 8 }}>
      <button onClick={() => { void save() }}>Save</button>
      <button onClick={() => { void publish.handleSave() }}>Publish</button>
      <button onClick={() => visual.visualHistoryStep('undo')}>Undo</button>
      <button onClick={() => visual.visualHistoryStep('redo')}>Redo</button>
      <output>{chars} characters</output>
    </nav>
    <div
      id="editor"
      ref={visualRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: '16px monospace', maxWidth: 1000 }}
      dangerouslySetInnerHTML={{ __html: docId === 1 ? initialHtml : '<p>Second document</p>' }}
      onCompositionStart={cloud.compositionStart}
      onCompositionEnd={cloud.compositionEnd}
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'z') { event.preventDefault(); visual.visualHistoryStep(event.shiftKey ? 'redo' : 'undo') } }}
      onInput={event => { start = performance.now(); const began = start; requestAnimationFrame(() => requestAnimationFrame(() => paintSamples.push(performance.now() - began))); const next = serialize(event.currentTarget); samples.push(performance.now() - start); visual.commitVisualMd(next) }}
    />
  </div>
}
function Harness() {
  const [docId, setDocId] = useState(1)
  return <><button id="switch" onClick={() => setDocId(id => id === 1 ? 2 : 1)}>Switch document</button><Editor key={docId} docId={docId} /></>
}
createRoot(document.getElementById('root')!).render(<Harness />)
