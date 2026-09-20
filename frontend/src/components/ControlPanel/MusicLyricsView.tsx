import type { UseMusicPlayerReturn } from '../../hooks/useMusicPlayer'
import { LuMusic } from '@lib/chromeStrokeIcons'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { getSongVipStatus } from '../../utils/musicPlayer'
import { LyricWaveScroll } from '../shared/LyricWaveScroll'

/**
 * 歌词页小封面：占位垫底 + 失败回退 + 缓存命中 complete 校正。
 * 避免条件挂载重进时偶发空白（load 事件已过 / 代理失败无回退）。
 */
const MusicLyricsCover = memo(({
  songId,
  cover,
}: {
  songId: string
  cover?: string | null
}) => {
  const coverUrl = (cover || '').trim()
  const coverKey = `${songId}:${coverUrl}`
  /** 仅当 failKey 对应当前 cover 时视为失败，切歌自动失效 */
  const [failKey, setFailKey] = useState<string | null>(null)
  const failed = Boolean(coverUrl) && failKey === coverKey
  const imgRef = useRef<HTMLImageElement>(null)

  // 磁盘/内存缓存命中时 load 可能已结束，onLoad 听不到 → 校正
  useLayoutEffect(() => {
    if (!coverUrl || failed) return
    const img = imgRef.current
    if (!img) return
    if (img.complete) {
      if (img.naturalWidth > 0) {
        img.style.display = ''
      } else {
        setFailKey(coverKey)
      }
    }
  }, [coverKey, coverUrl, failed])

  const showImg = Boolean(coverUrl) && !failed

  return (
    <div className="music-lyrics-cover" aria-hidden>
      {showImg && (
        <img
          ref={imgRef}
          key={coverKey}
          src={coverUrl}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={(e) => {
            e.currentTarget.style.display = ''
            setFailKey((k) => (k === coverKey ? null : k))
          }}
          onError={() => setFailKey(coverKey)}
        />
      )}
      <div
        className={`music-lyrics-cover__placeholder${showImg ? ' is-behind' : ''}`}
      >
        <LuMusic className="music-lyrics-cover__icon" aria-hidden />
      </div>
    </div>
  )
})

/** visible=false 时 is-hidden 保 DOM（封面不卸载），波浪引擎 paused */
export const MusicLyricsView = memo(({
  currentSong,
  lyrics,
  currentLyricIndex,
  setMusicPlayerView,
  musicColor,
  visible,
}: Pick<UseMusicPlayerReturn, 'currentSong' | 'lyrics' | 'currentLyricIndex' | 'setMusicPlayerView'> & {
  musicColor: string
  visible: boolean
}) => {
  const { t } = useI18n()

  if (!currentSong || lyrics.length === 0) {
    return null
  }

  const vipStatus = getSongVipStatus(currentSong)

  return (
    <div
      className={`music-view music-view-lyrics${visible ? '' : ' is-hidden'}`}
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
    >
      <div className="music-lyrics-header">
        <button
          type="button"
          onClick={() => setMusicPlayerView('info')}
          className="music-back-btn music-lyrics-back-btn"
          aria-label={t.music.back}
        >
          <svg
            className="music-lyrics-back-btn__icon"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="music-lyrics-back-btn__label">{t.music.back}</span>
        </button>
        <div className="music-lyrics-meta">
          <MusicLyricsCover songId={currentSong.id} cover={currentSong.cover} />
          <div className="music-lyrics-title">
            <div className="music-lyrics-song-name-row">
              <div className="music-lyrics-song-name">{currentSong.name}</div>
              {vipStatus.displayText && (
                <span
                  className={`music-vip-badge ${vipStatus.isTrial ? 'trial' : ''}`}
                >
                  {vipStatus.displayText}
                </span>
              )}
            </div>
            <div className="music-lyrics-artist">{currentSong.artist}</div>
          </div>
        </div>
      </div>

      <LyricWaveScroll
        variant="panel"
        lyrics={lyrics}
        currentLyricIndex={currentLyricIndex}
        musicColor={musicColor}
        paused={!visible}
      />
    </div>
  )
})
