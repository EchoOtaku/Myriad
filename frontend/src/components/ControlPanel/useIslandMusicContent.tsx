import type { DynamicContent } from './islandContentTypes'
import type { IslandMusicInput } from './islandMusicContent'
import { useEffect } from 'react'
import { WeatherAssetIcon } from '../weather/WeatherAssetIcon'
import { ISLAND_ASSETS } from './builtinIslandContents'
import { islandMusicContent } from './islandMusicContent'

export function useIslandMusicContent(input: IslandMusicInput, paused: boolean, onChange: (content: DynamicContent | null) => void) {
  const content = islandMusicContent(input)
  const text = content?.text
  const subtext = content?.subtext
  const playing = content?.playing
  const lyricDuration = content?.lyricDuration
  useEffect(() => {
    if (paused) return
    onChange(text === undefined ? null : {
      type: 'music', text, subtext, lyricDuration,
      icon: <WeatherAssetIcon icon={playing ? ISLAND_ASSETS.music : ISLAND_ASSETS.musicPaused} className="h-6 w-6 object-contain" fallbackClassName="dynamic-icon-emoji" />,
    })
  }, [paused, text, subtext, playing, lyricDuration, onChange])
}
