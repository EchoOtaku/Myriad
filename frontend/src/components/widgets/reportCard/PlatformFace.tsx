/**
 * Mount the platform-specific report face inside the card shell.
 */
import { isKnownReportPlatformId } from '../../../utils/reportCardVisuals'
import { PLATFORM_CONFIG } from './platformConfig'
import { BangumiWidget, MalWidget } from './platforms/anime'
import { BilibiliWidget } from './platforms/bilibili'
import { PsnWidget, SteamWidget, XboxWidget } from './platforms/gaming'
import { GithubWidget } from './platforms/github'
import { NeteaseWidget } from './platforms/netease'
import { DiscordWidget, XWidget } from './platforms/social'

interface PlatformFaceProps {
  platformId: string
  data: any
  showOverview: boolean
  onContentChange: (content: any) => void
  allowLoop: boolean
}

export function PlatformFace({
  platformId,
  data,
  showOverview,
  onContentChange,
  allowLoop,
}: PlatformFaceProps) {
  const platformConfig =
    PLATFORM_CONFIG[platformId] || PLATFORM_CONFIG.bilibili

  return (
    <>
      {platformId === 'bilibili' && (
        <BilibiliWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
          allowLoop={allowLoop}
        />
      )}
      {platformId === 'steam' && (
        <SteamWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {platformId === 'github' && (
        <GithubWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {platformId === 'netease' && (
        <NeteaseWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
          allowLoop={allowLoop}
        />
      )}
      {platformId === 'bangumi' && (
        <BangumiWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {platformId === 'mal' && (
        <MalWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {platformId === 'xbox' && (
        <XboxWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {platformId === 'psn' && (
        <PsnWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {platformId === 'x' && (
        <XWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {platformId === 'discord' && (
        <DiscordWidget
          data={data}
          showOverview={showOverview}
          onContentChange={onContentChange}
        />
      )}
      {/* Data mapped but no platform branch: still show key stats (not a blank shell). */}
      {!isKnownReportPlatformId(platformId) && (
        <div className="flex h-full flex-col justify-center gap-1 p-3 text-xs text-gray-600 dark:text-gray-300">
          <div className="font-bold text-gray-800 dark:text-gray-100">
            {platformConfig.label}
          </div>
          {typeof data?.hardcore_score === 'number' && (
            <div>Score {data.hardcore_score}</div>
          )}
          {typeof data?.games_count === 'number' && (
            <div>Games {data.games_count}</div>
          )}
          {typeof data?.player_type === 'string' && <div>{data.player_type}</div>}
          {typeof data?.vibe === 'string' && (
            <div className="line-clamp-2">{data.vibe}</div>
          )}
          {typeof data?.contribution_level === 'string' && (
            <div>{data.contribution_level}</div>
          )}
        </div>
      )}
    </>
  )
}
