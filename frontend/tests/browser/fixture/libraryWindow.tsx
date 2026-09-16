import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { buildLibraryListIndex } from '../../../src/components/library/libraryListWindow'
import { useLibraryListWindow } from '../../../src/components/library/useLibraryListWindow'
import LibraryGrid from '../../../src/components/LibraryGrid'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import '../../../src/styles/tailwind.css'

const items = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i) }))
const layouts = new Map(items.map((item, i) => [item.id, {
  top: Math.floor(i / 4) * 200, height: 180,
}]))
function WindowFixture() {
  const surface = useRef<HTMLDivElement>(null)
  const [revision, setRevision] = useState(0)
  const index = useMemo(() => buildLibraryListIndex(items.slice(0, 10_000 - revision), layouts), [revision])
  useEffect(() => {
    const rebuild = () => setRevision(value => value + 1)
    document.addEventListener('library-reindex', rebuild)
    return () => document.removeEventListener('library-reindex', rebuild)
  }, [])
  const visible = useLibraryListWindow(surface, index, true)
  return <div ref={surface} data-testid="extent" data-revision={revision} style={{ position: 'relative', height: index.height }}>
    {visible.map(item => <button
      key={item.id}
      data-library-list-id={item.id}
      style={{
      position: 'absolute', top: layouts.get(item.id)!.top,
      left: (Number(item.id) % 4) * 200, height: 180, width: 180,
    }}
                         >{item.id}</button>)}
  </div>
}
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).has('grid')
    ? <I18nProvider><LibraryGrid filter="all" /></I18nProvider>
    : <WindowFixture />,
)
