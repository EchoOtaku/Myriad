import type { UseMusicPlayerReturn } from '../../hooks/useMusicPlayer'
import { lazy, Suspense } from 'react'
import { WidgetSkeleton } from '../widgets/shared/WidgetSkeleton'
import '../MusicPlayerShell.css'

const MusicPlayer = lazy(() => import('./MusicPlayer'))

/** Preserve panel geometry while loading the enabled player's UI and styles. */
export function MusicPlayerHost({ player, panelVisible }: {
  player: UseMusicPlayerReturn
  panelVisible: boolean
}) {
  if (!player.musicEnabled) return null
  return (
    <Suspense fallback={(
      <div className="music-player-container music-view-mode-info" data-music-loading aria-busy="true">
        <WidgetSkeleton preset="media-row" animated={panelVisible} />
      </div>
    )}
    >
      <MusicPlayer player={player} panelVisible={panelVisible} />
    </Suspense>
  )
}
