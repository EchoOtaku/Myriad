import {
  AnimatePresenceShim as AnimatePresence,
  motionShim as motion,
} from '@lib/motionShim'
import { memo, useEffect, useMemo } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { useLoopAnimation } from '../../../../hooks/animation'
import {
  CONTENT_FADE_ANIMATE,
  CONTENT_FADE_EXIT,
  CONTENT_FADE_INITIAL,
  CONTENT_FADE_TRANSITION,
  CONTENT_SLIDE_ANIMATE,
  CONTENT_SLIDE_EXIT,
  CONTENT_SLIDE_INITIAL,
  CONTENT_SLIDE_TRANSITION,
  createDanmakuTransition,
  DANMAKU_ANIMATE,
  DANMAKU_INITIAL,
  LANES_ARRAY,
} from '../animations'
import { useLibraryItemRotation } from '../hooks'
import { getBilibiliProxyUrl } from '../media'

// ==================== B站组件（完整版）====================
export const DanmakuWidget = memo(
  ({
    data,
    allowLoop = true,
    triggerKey,
  }: {
    data?: { danmaku?: string[] }
    allowLoop?: boolean
    triggerKey?: unknown
  }) => {
    const { t } = useI18n()
    const defaultDanmaku = t.reportCard.danmakuDefault as unknown as string[]
    const texts = useMemo(
      () => data?.danmaku || defaultDanmaku,
      [data?.danmaku, defaultDanmaku],
    )

    // 🆕 使用触发式动画 - triggerKey 变化时播放一轮，完成后自动释放
    useLoopAnimation({
      duration: 11000, // 弹幕滚动约8秒 + 额外保持3秒
      trigger: triggerKey, // 状态切换时触发
      enabled: allowLoop, // 低端设备禁用
    })

    // 🆕 低性能模式：限制弹幕数量不超过3条
    // 🔧 用 useMemo 锁定：仅在 loop 状态变化时重算随机，避免每次渲染重新洗牌弹幕
    const maxDanmakuCount = useMemo(
      () =>
        allowLoop
          ? Math.random() < 0.7
            ? Math.random() < 0.5
              ? 3
              : 4
            : 5
          : 3,
      [allowLoop],
    )

    const animations = useMemo(() => {
      // 🔧 使用预生成的 LANES_ARRAY 进行洗牌
      const availableLanes = [...LANES_ARRAY]
      for (let i = availableLanes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[availableLanes[i], availableLanes[j]] = [
          availableLanes[j],
          availableLanes[i],
        ]
      }
      return texts.slice(0, maxDanmakuCount).map((_, i) => ({
        duration: 6 + Math.random() * 4,
        delay: i * 0.7 + Math.random() * 0.5,
        top: `${10 + availableLanes[i] * 18}%`,
        opacity: 0.4 + Math.random() * 0.3,
      }))
    }, [texts, maxDanmakuCount])

    return (
      <div className="relative h-full w-full overflow-hidden">
        {animations.map((anim, i) => (
          <motion.div
            key={`${texts[i]}-${i}`}
            initial={DANMAKU_INITIAL}
            animate={DANMAKU_ANIMATE}
            transition={createDanmakuTransition(anim.duration, anim.delay)}
            className="absolute whitespace-nowrap text-base font-bold danmaku-text-color gpu-accelerated"
            style={{
              top: anim.top,
              opacity: anim.opacity,
            }}
          >
            {texts[i]}
          </motion.div>
        ))}
      </div>
    )
  },
)
DanmakuWidget.displayName = 'DanmakuWidget'

export const BilibiliWidget = memo(
  ({ data, showOverview, onContentChange, allowLoop = true }: any) => {
    const libraryItems = useMemo(
      () => data?.library_items || [],
      [data?.library_items],
    )
    const { currentItem, currentItemIndex } = useLibraryItemRotation(
      libraryItems,
      showOverview,
    )

    useEffect(() => {
      if (!showOverview && currentItem) {
        onContentChange?.({ title: currentItem.title, type: currentItem.type })
      } else {
        onContentChange?.(null)
      }
    }, [showOverview, currentItem, onContentChange])

    return (
      <AnimatePresence mode="wait">
        {showOverview || !currentItem ? (
          <motion.div
            key="danmaku"
            initial={CONTENT_FADE_INITIAL}
            animate={CONTENT_FADE_ANIMATE}
            exit={CONTENT_FADE_EXIT}
            transition={CONTENT_FADE_TRANSITION}
            className="h-full w-full"
          >
            <DanmakuWidget
              data={data}
              allowLoop={allowLoop}
              triggerKey={showOverview}
            />
          </motion.div>
        ) : (
          <motion.div
            key={`lib-${currentItemIndex}`}
            initial={CONTENT_SLIDE_INITIAL}
            animate={CONTENT_SLIDE_ANIMATE}
            exit={CONTENT_SLIDE_EXIT}
            transition={CONTENT_SLIDE_TRANSITION}
            className="h-full w-full p-1.5"
          >
            <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg bg-white dark:bg-black/90">
              <div className="absolute inset-0">
                <img
                  src={getBilibiliProxyUrl(
                    currentItem.cover,
                    currentItem.title,
                  )}
                  alt={currentItem.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-transparent" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  },
)
