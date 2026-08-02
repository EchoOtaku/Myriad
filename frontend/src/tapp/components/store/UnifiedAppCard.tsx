/** App Store style list row. */

import type { useAnimationLevel } from '../../../hooks/useAnimationLevel'
import type { UnifiedAppItem } from './types'
import { motionShim as motion } from '@lib/motionShim'
import { forwardRef, useMemo } from 'react'
import { Spinner } from '../../../components/Spinner'
import { useI18n } from '../../../contexts/I18nContext'
import { isExlight } from '../../../hooks/useAnimationLevel'
import {
  compareVersions,
  packageProgressLabel,
} from '../../utils/tappStoreHelpers'
import { TappIconBadge } from '../TappIconBadge'
import {
  getAppIconStyle,
  isOfficialStoreApp,
  OfficialVerifiedDot,
} from './storeAppMeta'
import { ProgressPercent, StoreGetButton } from './StoreChrome'

export const UnifiedAppCard = forwardRef<
  HTMLDivElement,
  {
    app: UnifiedAppItem
    isInstalled: boolean
    installedVersion?: string
    date?: string
    onInstall: () => void
    onUpdate?: () => void
    /** Open store detail (row click). */
    onOpen: () => void
    /** Launch installed app (Get button when installed). */
    onLaunch: () => void
    installing: boolean
    installPercent?: number | null
    installPhase?: string | null
    installDetail?: string | null
    updating?: boolean
    animConfig?: ReturnType<typeof useAnimationLevel>
    index?: number
  }
>(
  (
    {
      app,
      isInstalled,
      installedVersion,
      date,
      onInstall,
      onUpdate,
      onOpen,
      onLaunch,
      installing,
      installPercent,
      installPhase,
      installDetail,
      updating,
      animConfig,
      index = 0,
    },
    ref,
  ) => {
    const { t, locale } = useI18n()
    const busy = installing || updating
    const busyProgress = installPercent != null && busy
    const hasUpdate =
      isInstalled &&
      !!installedVersion &&
      compareVersions(app.version, installedVersion) > 0

    // initial:false — motionShim 未就绪时若写 opacity:0 会卡死不可见
    // （列表壳层 viewMotionProps 同样策略）
    const animProps = useMemo(() => {
      if (!animConfig || isExlight(animConfig)) {
        return {
          initial: false as const,
          animate: undefined,
          transition: undefined,
        }
      }
      const delay = Math.min(index, 12) * 0.028 * animConfig.durationScale
      return {
        initial: false as const,
        animate: { opacity: 1, y: 0 },
        transition: {
          delay,
          duration: 0.32 * animConfig.durationScale,
          ease: [0.22, 1, 0.36, 1] as const,
        },
      }
    }, [animConfig, index])

    const iconStyle = getAppIconStyle(app)
    const subtitle = app.description || app.author.name
    const dateValue = date ? new Date(date) : null
    const dateLabel =
      dateValue && !Number.isNaN(dateValue.getTime())
        ? dateValue.toLocaleDateString(locale)
        : null

    return (
      <motion.div
        ref={ref}
        initial={animProps.initial}
        animate={animProps.animate}
        transition={animProps.transition}
        className="as-store-row"
        role="button"
        tabIndex={0}
        title={t.tapp.viewDetails}
        onClick={onOpen}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
      >
        <TappIconBadge
          icon={app.icon}
          iconSvg={app.iconSvg}
          name={app.name}
          themeColor={app.themeColor}
          category={app.category}
          id={app.id}
          permissions={app.permissions}
          iconStyle={iconStyle}
          shellClassName="as-store-row__icon"
          glyphSizeClass="w-8 h-8"
          glyphTextClass="text-2xl"
        />

        <div className="as-store-row__body">
          <div className="as-store-row__name">
            {app.name}
            {isOfficialStoreApp(app) ? (
              <OfficialVerifiedDot label={t.tapp.official} />
            ) : null}
          </div>
          <div className="as-store-row__sub">{subtitle}</div>
          {dateLabel && <div className="as-store-row__sub2">{dateLabel}</div>}
        </div>

        <div className="as-store-row__side">
          {busy ? (
            <StoreGetButton
              kind="busy"
              disabled
              title={
                busyProgress
                  ? packageProgressLabel(
                      t.tapp,
                      updating ? 'update' : 'install',
                      installPhase,
                      installPercent!,
                      installDetail,
                    )
                  : updating
                    ? t.tapp.updating
                    : t.tapp.installing
              }
              label={
                busyProgress ? (
                  <ProgressPercent
                    value={installPercent!}
                    className="text-[0.75rem]"
                  />
                ) : (
                  <Spinner size="xs" color="current" />
                )
              }
            />
          ) : hasUpdate && onUpdate ? (
            <StoreGetButton
              kind="update"
              label={t.tapp.update}
              title={t.tapp.update}
              onClick={(e) => {
                e.stopPropagation()
                onUpdate()
              }}
            />
          ) : isInstalled ? (
            <StoreGetButton
              kind="open"
              label={t.tapp.start}
              title={t.tapp.start}
              onClick={(e) => {
                e.stopPropagation()
                onLaunch()
              }}
            />
          ) : (
            <StoreGetButton
              kind="get"
              label={t.tapp.install}
              title={t.tapp.install}
              onClick={(e) => {
                e.stopPropagation()
                onInstall()
              }}
            />
          )}
        </div>

        {busyProgress && (
          <div className="as-store-row__progress" aria-hidden>
            <i style={{ width: `${Math.max(2, installPercent!)}%` }} />
          </div>
        )}
      </motion.div>
    )
  },
)

UnifiedAppCard.displayName = 'UnifiedAppCard'
