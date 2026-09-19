import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useSiteOwnerProfile } from '../../../src/hooks/useSiteOwnerProfile'

function Consumer({ enabled, copy }: { enabled: boolean, copy: string }) {
  const { profile, avatarEpoch } = useSiteOwnerProfile({ enabled, fallbackName: 'Fallback', fallbackBio: copy })
  return <><output>{profile?.name ?? 'empty'}</output><span data-bio>{profile?.bio}</span><span data-epoch>{avatarEpoch}</span></>
}
function Fixture() {
  const [copy, setCopy] = useState('Copy A')
  const [enabled, setEnabled] = useState(true)
  const [mounted, setMounted] = useState(true)
  return <><button onClick={() => setCopy(value => value === 'Copy A' ? 'Copy B' : 'Copy A')}>Toggle copy</button><button onClick={() => setEnabled(value => !value)}>Toggle enabled</button><button onClick={() => setMounted(value => !value)}>Toggle mounted</button>{mounted && <Consumer enabled={enabled} copy={copy} />}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
