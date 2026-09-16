import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import NavigationIsland from '../../../src/components/NavigationIsland'
import { usePhantasiNavExpand } from '../../../src/components/phantasi/usePhantasiNavExpand'
import { AuthProvider } from '../../../src/contexts/AuthContext'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import { NavigationProvider, useSecondaryNav } from '../../../src/contexts/NavigationContext'
import '../../../src/styles/navigation-island.css'

const items = [{ id: 'feeds', label: 'Feeds', icon: 'Feeds' }]
function Harness() {
  const navigate = useNavigate()
  const { setExpanded } = useSecondaryNav({ routePath: '/journal', items, defaultActiveId: 'feeds' })
  usePhantasiNavExpand(setExpanded)
  return <>
    <button onClick={() => navigate('/journal/notes')}>Open notes</button>
    <NavigationIsland />
  </>
}
export function mountNavigationIsland() {
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter><I18nProvider><AuthProvider><NavigationProvider><Harness /></NavigationProvider></AuthProvider></I18nProvider></BrowserRouter>,
  )
}
