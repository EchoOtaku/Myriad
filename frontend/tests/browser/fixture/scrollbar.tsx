import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import CustomScrollbar from '../../../src/components/CustomScrollbar'
import './phantasiProduction.css'

function Harness() {
  const navigate = useNavigate()
  useEffect(() => {
    Object.assign(window, { scrollbarFixture: { navigate } })
  }, [navigate])
  return <CustomScrollbar />
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Harness /></BrowserRouter>)
