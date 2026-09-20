import type { ComponentProps } from 'react'
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MusicLyricsView } from '../../../src/components/ControlPanel/MusicLyricsView'
import { MusicPlaylistView } from '../../../src/components/ControlPanel/MusicPlaylistView'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import '../../../src/components/MusicPlayer.css'

const playlist = Array.from({ length: 100 }, (_, index) => ({
  id: String(index), name: `Track ${index}`, artist: index < 30 ? 'Match' : 'Other',
  album: '', cover: '', url: '', duration: 180, source: 'netease' as const,
}))
function Harness() {
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('')
  const [excludeVipSongs, setExcludeVipSongs] = useState(false)
  const [selected, setSelected] = useState(-1)
  const playlistScrollRef = useRef<HTMLDivElement>(null)
  const player: Omit<ComponentProps<typeof MusicPlaylistView>, 'visible'> = {
    playlist, currentSongIndex: 90, isPlaying: false, playlistSearchQuery,
    setPlaylistSearchQuery, excludeVipSongs, setExcludeVipSongs, playlistScrollRef,
    setMusicPlayerView: () => {},
    selectSong: async (_song, index) => { setSelected(index) },
  }
  return <>
    <output id="selected">{selected}</output>
    <div className="music-player-container" style={{ width: 400, height: 400 }}>
      <MusicPlaylistView {...player} visible />
    </div>
  </>
}
export function mountPlaylist() {
  createRoot(document.getElementById('root')!).render(<I18nProvider><Harness /></I18nProvider>)
}

const lyrics = [{ time: 0, text: 'First lyric' }, { time: 10, text: 'Second lyric' }]
function LyricsHarness() {
  const [song, setSong] = useState({ ...playlist[0], isVip: false, isTrial: false,
    cover: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>' })
  const [visible, setVisible] = useState(true)
  const [view, setView] = useState('lyrics')
  return <>
    <button onClick={() => setSong(previous => ({ ...previous, isVip: true }))}>Update VIP</button>
    <button onClick={() => setSong(previous => ({ ...previous, isTrial: true }))}>Update trial</button>
    <button onClick={() => setVisible(previous => !previous)}>Toggle lyrics</button>
    <output id="view">{view}</output>
    <div className="music-player-container" style={{ width: 400, height: 400 }}>
      <MusicLyricsView
        currentSong={song}
        lyrics={lyrics}
        currentLyricIndex={0}
        setMusicPlayerView={setView}
        visible={visible}
        musicColor="#ef4444"
      />
    </div>
  </>
}
export function mountLyrics() {
  createRoot(document.getElementById('root')!).render(<I18nProvider><LyricsHarness /></I18nProvider>)
}
