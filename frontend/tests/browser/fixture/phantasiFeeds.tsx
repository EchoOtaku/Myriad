import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { makePreviews, makeSource } from '../../../src/components/phantasi/logic/fixtures'
import { PhantasiViewLane } from '../../../src/components/phantasi/skin/PhantasiChip'
import PhantasiFeeds from '../../../src/components/phantasi/skin/PhantasiFeeds'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import './phantasiProduction.css'
import '../../../src/components/phantasi/ui/phantasi.css'

const count = Math.min(120, Math.max(12, Number(new URLSearchParams(location.search).get('sources')) || 12))
const stories = makePreviews(8)
const sources = Array.from({ length: count }, (_, i) => makeSource({ id: i + 1, name: `Source ${i + 1}`, recent_items: stories }))
function Harness() {
  const [show, setShow] = useState(true)
  return <>
    <button onClick={() => setShow(value => !value)}>switch board</button>
    <div style={{ height: 'calc(100vh - 70px)', display: 'flex', padding: 16 }}>
      <PhantasiViewLane wave={show ? 'feeds' : 'other'}>
        {show ? <PhantasiFeeds sources={sources} stories={stories} onSourceClick={() => {}} /> : <div data-phantasi-surface="title">Other board</div>}
      </PhantasiViewLane>
    </div>
  </>
}
createRoot(document.getElementById('root')!).render(<I18nProvider><Harness /></I18nProvider>)
