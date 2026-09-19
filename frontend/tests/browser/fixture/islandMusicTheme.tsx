import type { DynamicContent } from '../../../src/components/ControlPanel/islandContentTypes'
import { StrictMode, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useIslandMusicContent } from '../../../src/components/ControlPanel/useIslandMusicContent'
import { useThemePreference } from '../../../src/hooks/useThemePreference'
import { themeBootInlineScript } from '../../../src/utils/themeBootScript'
import { getIsDarkMode, useThemeMode } from '../../../src/utils/themeSubscriber'

const boot = document.createElement('script')
boot.textContent = themeBootInlineScript()
document.head.append(boot)

function ThemeProbe({ id }: { id: string }) {
  const { themePreference, cycleThemePreference } = useThemePreference()
  const dark = useThemeMode()
  return <>
    <button data-cycle={id} onClick={cycleThemePreference}>Cycle {id}</button>
    <output data-theme={id}>{themePreference}</output>
    <output data-dark={id}>{String(dark)}</output>
  </>
}
function Probe() {
  const [themesMounted, setThemesMounted] = useState(true)
  const [song, setSong] = useState({ id: 'one', name: 'First', artist: 'Artist A' })
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [music, setMusic] = useState<DynamicContent | null>(null)
  const onMusic = useCallback((content: DynamicContent | null) => setMusic(content), [])
  useIslandMusicContent({ currentSong: song, isPlaying: true, lyrics: [{ time: 0, text: 'Same line' }, { time: 3, text: 'Same line' }, { time: 10, text: 'Final' }], currentLyricIndex: index }, paused, onMusic)
  return <>
    <button onClick={() => setThemesMounted(value => !value)}>Toggle themes</button>
    {themesMounted && <><ThemeProbe id="a" /><ThemeProbe id="b" /></>}
    <button onClick={() => setSong({ id: 'two', name: 'Second', artist: 'Artist B' })}>Next song</button>
    <button onClick={() => setIndex(1)}>Next line</button>
    <button onClick={() => setPaused(value => !value)}>Toggle panel</button>
    <output data-song>{music?.subtext}</output><output data-duration>{music?.lyricDuration}</output>
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Probe /></StrictMode>)
Object.assign(window, { islandMusicThemeFixture: { getIsDarkMode } })
