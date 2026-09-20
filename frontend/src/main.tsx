import { createRoot } from 'react-dom/client'
import App from './App'
import { initPageLoader } from './utils/pageLoader'
import { initSiteMetadata } from './utils/siteMetadata'
import './styles/tailwind.css'

initPageLoader()
initSiteMetadata()
void import('./utils/pwa').then((m) => m.initPwaLifecycle())

createRoot(document.getElementById('app-root')!).render(<App />)
