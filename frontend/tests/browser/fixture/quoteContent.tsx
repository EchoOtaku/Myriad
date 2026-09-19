import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useQuoteContent } from '../../../src/components/widgets/useQuoteContent'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import apiService from '../../../src/services/api'
import { HITOKOTO_CONFIG_UPDATED_EVENT } from '../../../src/utils/quote'

const pending: Array<(value: unknown) => void> = []
Object.assign(apiService, { get: async () => ({ success: true, config: { sourceId: 'hitokoto-cn' } }) })
window.fetch = async () => ({ ok: true, json: () => new Promise(resolve => pending.push(resolve)) }) as Response
Object.assign(window, { quoteContentFixture: {
  count: () => pending.length,
  finish: (index: number, text: string) => pending[index]({ hitokoto: text }),
  refresh: () => window.dispatchEvent(new CustomEvent(HITOKOTO_CONFIG_UPDATED_EVENT, { detail: { sourceId: 'hitokoto-cn' } })),
} })
function Consumer({ preview }: { preview: boolean }) {
  const { quoteData, loading } = useQuoteContent(preview)
  return <output>{loading ? 'loading' : quoteData?.text}</output>
}
function Fixture() {
  const [mounted, setMounted] = useState(true)
  const [preview, setPreview] = useState(false)
  return <><button onClick={() => setMounted(value => !value)}>Toggle</button><button onClick={() => setPreview(true)}>Preview</button>{mounted && <Consumer preview={preview} />}</>
}
createRoot(document.getElementById('root')!).render(<I18nProvider><Fixture /></I18nProvider>)
