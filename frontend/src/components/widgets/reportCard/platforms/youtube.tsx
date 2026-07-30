/**
 * YouTube report face — public channel stats + recent upload rotation.
 */
import {
  AnimatePresenceShim as AnimatePresence,
  motionShim as motion,
} from '@lib/motionShim'
import { memo, useEffect, useMemo } from 'react'
import { useLibraryItemRotation } from '../hooks'

function safeNonNegInt(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export const YoutubeWidget = memo(
  ({ data, showOverview, onContentChange, allowLoop = true }: any) => {
    const libraryItems = useMemo(
      () =>
        (data?.library_items || data?.recent_videos || []).map(
          (item: any) => ({
            title: item.title,
            type: item.type || 'video',
            image: item.image || item.cover,
            url: item.url,
            view_count: item.view_count,
          }),
        ),
      [data?.library_items, data?.recent_videos],
    )
    const { currentItem, currentItemIndex } = useLibraryItemRotation(
      libraryItems,
      showOverview && allowLoop,
    )

    const subscribers = useMemo(
      () => safeNonNegInt(data?.subscriber_count),
      [data?.subscriber_count],
    )
    const views = useMemo(
      () => safeNonNegInt(data?.view_count),
      [data?.view_count],
    )
    const videos = useMemo(
      () => safeNonNegInt(data?.video_count),
      [data?.video_count],
    )
    const channelTitle = useMemo(
      () =>
        (data?.channel_title as string) ||
        (data?.username as string) ||
        'YouTube',
      [data?.channel_title, data?.username],
    )

    useEffect(() => {
      if (!showOverview && currentItem) {
        onContentChange?.({
          title: currentItem.title,
          type: currentItem.type || 'video',
        })
      } else {
        onContentChange?.(null)
      }
    }, [showOverview, currentItem, onContentChange])

    if (!showOverview && currentItem) {
      return (
        <div className="relative h-full w-full overflow-hidden p-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentItemIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="flex h-full flex-col gap-2"
            >
              {currentItem.image ? (
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/10">
                  <img
                    src={currentItem.image}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-red-500/10 text-xs font-bold text-red-600">
                  YouTube
                </div>
              )}
              <div className="min-h-0 flex-1">
                <div className="line-clamp-2 text-sm font-bold text-gray-900 dark:text-gray-100">
                  {currentItem.title}
                </div>
                {typeof currentItem.view_count === 'number' && (
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {formatCompact(currentItem.view_count)} views
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )
    }

    const isEmptyChannel =
      data?.is_empty_channel === true ||
      (videos === 0 && libraryItems.length === 0)

    return (
      <div className="relative flex h-full w-full flex-col justify-between overflow-hidden p-2.5">
        <div className="space-y-2">
          <motion.div
            className="line-clamp-1 text-xs font-bold text-gray-800 dark:text-gray-100"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {channelTitle}
          </motion.div>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                [subscribers, 'Subs'],
                [views, 'Views'],
                [videos, 'Videos'],
              ] as const
            ).map(([value, label], i) => (
              <motion.div
                key={label}
                className="rounded-lg bg-red-500/10 px-1.5 py-1.5 text-center"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.08 * i }}
              >
                <div className="text-base font-black leading-none text-red-600 dark:text-red-400">
                  {formatCompact(value)}
                </div>
                <div className="mt-1 text-[8px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        {isEmptyChannel ? (
          <motion.p
            className="line-clamp-3 text-[10px] leading-snug text-amber-700 dark:text-amber-300"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            {typeof data?.video_summary === 'string' && data.video_summary
              ? data.video_summary
              : 'Public channel linked — no uploads yet. Empty is OK, not a sync error.'}
          </motion.p>
        ) : data?.video_summary ? (
          <motion.p
            className="line-clamp-2 text-[10px] leading-snug text-gray-600 dark:text-gray-300"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            {data.video_summary}
          </motion.p>
        ) : (
          <div className="text-[10px] text-gray-500">
            {libraryItems.length > 0
              ? `${libraryItems.length} recent uploads`
              : 'YouTube public channel'}
          </div>
        )}
      </div>
    )
  },
)
YoutubeWidget.displayName = 'YoutubeWidget'
