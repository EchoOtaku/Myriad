import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  makeItem,
  makeSource,
} from '../../../src/components/phantasi/logic/fixtures'
import PhantasiList from '../../../src/components/phantasi/skin/PhantasiList'
import PhantasiNotes from '../../../src/components/phantasi/skin/PhantasiNotes'
import { I18nNamespace, I18nProvider } from '../../../src/contexts/I18nContext'
import '../../../src/styles/tailwind.css'
import '../../../src/styles/spa-document.css'
import '../../../src/styles/theme.css'
import '../../../src/styles/animations.css'
import '../../../src/styles/utility.css'
import '../../../src/styles/performance.css'
import '../../../src/components/phantasi/ui/phantasi.css'

export function mountJournal(mode: 'list' | 'notes', count: number) {
  const initial = Array.from({ length: count }, (_, index) =>
    makeItem({
      id: index + 1,
      published_at: count - index,
      topic: index < 20 ? 'first' : 'history',
    }),
  )
  function Harness() {
    const [items, setItems] = useState(initial)
    const [sources, setSources] = useState([
      makeSource({ source_type: 'note' }),
    ])
    const [requests, setRequests] = useState(0)
    const [loading, setLoading] = useState(false)
    const [hasMore, setHasMore] = useState(count === 24)
    const [category, setCategory] = useState<string | null>(null)
    const [opened, setOpened] = useState(0)
    const open = useCallback((item: { id: number }) => setOpened(item.id), [])
    const load = useCallback(() => {
      setRequests((value) => value + 1)
      setLoading(true)
    }, [])
    return (
      <>
        <output data-testid="requests">{requests}</output>
        <output data-testid="opened">{opened}</output>
        <button
          onClick={() => {
            setItems((prev) => [
              ...prev,
              ...Array.from({ length: 24 }, (_, i) =>
                makeItem({ id: prev.length + i + 1 }),
              ),
            ])
            setLoading(false)
          }}
        >
          append page
        </button>
        <button
          onClick={() => {
            setHasMore(false)
            setLoading(false)
          }}
        >
          end pages
        </button>
        <button
          onClick={() => setCategory((value) => (value ? null : 'history'))}
        >
          filter history
        </button>
        <button
          onClick={() =>
            setSources((prev) => [
              ...prev,
              makeSource({ id: 2, source_type: 'note' }),
            ])
          }
        >
          add source
        </button>
        <button
          onClick={() =>
            setItems((prev) => [
              ...prev,
              makeItem({ id: prev.length + 1, source_id: 2 }),
            ])
          }
        >
          resolve source
        </button>
        <div style={{ height: 820, display: 'flex', padding: 16 }}>
          {mode === 'list' ? (
            <PhantasiList
              items={items}
              selectedItem={null}
              loading={loading}
              hasMore={hasMore}
              total={items.length}
              onItemSelect={open}
              onLoadMore={load}
            />
          ) : (
            <PhantasiNotes
              sources={sources}
              notes={items}
              docs={[]}
              category={category}
              onSourceClick={() => {}}
              onOpenItem={open}
            />
          )}
        </div>
      </>
    )
  }
  createRoot(document.getElementById('root')!).render(
    <I18nProvider><I18nNamespace names={['phantasi']}>
      <Harness />
    </I18nNamespace></I18nProvider>,
  )
}
