import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NoteTopBar } from '../../../src/components/phantasi/notes/NoteEditorChrome'
import { NoteEditorSettings } from '../../../src/components/phantasi/notes/NoteEditorSettings'
import { useNoteEditorPreference } from '../../../src/components/phantasi/notes/useNoteEditorPreference'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import { restoreNoteHistory } from '../../../src/services/phantasiApi'
import '../../../src/styles/tailwind.css'
import '../../../src/styles/theme.css'
import '../../../src/components/phantasi/ui/phantasi.css'
import '../../../src/components/phantasi/notes/NoteEditor.css'

function Harness() {
  const [view, setView] = useState('visual')
  const [content, setContent] = useState('Current draft')
  const [typing, setTyping] = useState(false)
  const preference = useNoteEditorPreference(1, setView, () => {})
  return <div className="phantasi-skin phantasi-note">
    <div className="phantasi-note__frame">
      <NoteTopBar
        docStatus="draft"
        lastError={null}
        scheduledAt={null}
        cloudHint={false}
        peers={[{ peerId: 'bob', userId: 2, name: 'Bob', lastEditAt: typing ? Date.now() : undefined }]}
        collabConnection="connected"
        saving={false}
        loading={false}
        onPublish={() => {}}
        settingsOpen
        onToggleSettings={() => {}}
        onClose={() => {}}
      />
      <main style={{ padding: 20 }}>
        <output id="view">{view}</output>
        <output id="content">{content}</output>
        <button onClick={() => setTyping(true)}>Simulate typing</button>
      </main>
      {!new URLSearchParams(location.search).has('collab') ? <aside className="phantasi-note__drawer">
        <h2>Settings</h2>
        <NoteEditorSettings
          cloudId={1}
          defaultView={preference.defaultView}
          preferenceBusy={preference.busy}
          onDefaultView={preference.changeDefaultView}
          busy={false}
          onRestore={async entry => {
            const result = await restoreNoteHistory(1, entry.revision, 20, 'restore-request', { title: 'Note', content_md: content, topic: null, image: null, published_at: null })
            setContent(result.content_md)
          }}
        />
      </aside> : null}
    </div>
  </div>
}
createRoot(document.getElementById('root')!).render(<I18nProvider><Harness /></I18nProvider>)
