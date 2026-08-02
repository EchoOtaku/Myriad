/**
 * 排行条列表：页面 / 事件 / 来源共用
 *
 * - 一个序列一个颜色，不按排名深浅（长度已经在表达大小，色相不重复编码）
 * - 条只是量级速读，每行数值都直接可见（不靠悬停、不靠配色）
 * - 列头与数据行同一套 CSS Grid 模板，数字列天然对齐
 * - 窄容器（两列半幅 / 小屏）用 container query 叠成「名称 → 条 + 数字」
 * - 视口大约只露 8 行（CSS max-height）；DOM 先挂 30 条，滚到尾再挂剩余
 */

import type { ReactNode, UIEvent } from 'react'
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EmptyCard } from './EmptyCard'

export interface RankSubRow {
  key: string
  name: string
  value: number
  secondary?: string
}

export interface RankRow {
  key: string
  /** 主标题（本地化后的名称） */
  name: string
  /** 副标题：原始路径 / 事件名，等宽显示 */
  meta?: string
  /** 决定条长的主指标 */
  value: number
  /** 已格式化的次要数值 */
  secondary?: string
  /** 已格式化的第三列（如均停），无数据传 undefined */
  tertiary?: string
  /** 事件维度 breakdown（如各 tapp / 平台） */
  subRows?: RankSubRow[]
}

interface RankListProps {
  rows: RankRow[]
  /** 已格式化的主指标（与 value 同序） */
  formatValue: (n: number) => string
  headers: {
    name: string
    value: string
    secondary?: string
    tertiary?: string
  }
  emptyText: string
  /** 空态占位卡的图标，默认收件箱 */
  emptyIcon?: ReactNode
  loading?: boolean
  refreshing?: boolean
  /**
   * 首批挂载行数（默认 30）。视口仍只约显示 8 行；
   * 滚到列表尾部后再挂上剩余全部行。
   */
  initialCount?: number
}

/** 首批 DOM 行数：可滚动窗口里大约只看见 8 行 */
export const DEFAULT_RANK_LOAD_COUNT = 30
/** 距底部多少 px 视为「滚到尾」 */
const SCROLL_LOAD_THRESHOLD_PX = 32

/**
 * 滚动触底后的下一可见行数：直接拉满 total（剩余一次挂完）。
 * 纯函数便于单测。
 */
export function nextRankVisibleCount(
  current: number,
  total: number,
): number {
  if (total <= 0) return 0
  if (current >= total) return total
  return total
}

/** 首批挂载上限（非法 initialCount 时回退默认 30） */
export function clampRankInitialLoad(
  initialCount: unknown,
  total: number,
): number {
  const raw = Math.floor(Number(initialCount))
  const page =
    Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RANK_LOAD_COUNT
  if (total <= 0) return 0
  return Math.min(total, page)
}

/** 列表数据签名：条数 + 首尾 key，用于重置可见窗口（刷新后不沿用旧的「已加载到 N」）。 */
function rowsWindowKey(rows: RankRow[]): string {
  if (rows.length === 0) return '0'
  return `${rows.length}:${rows[0]?.key ?? ''}:${rows[rows.length - 1]?.key ?? ''}`
}

export const RankList: React.FC<RankListProps> = ({
  rows,
  formatValue,
  headers,
  emptyText,
  emptyIcon,
  loading = false,
  refreshing = false,
  initialCount = DEFAULT_RANK_LOAD_COUNT,
}) => {
  const listRef = useRef<HTMLUListElement>(null)
  const windowKey = rowsWindowKey(rows)
  const [visibleCount, setVisibleCount] = useState(() =>
    clampRankInitialLoad(initialCount, rows.length),
  )

  // 数据窗口变化时回到首批 30（区间切换 / 刷新）
  useEffect(() => {
    setVisibleCount(clampRankInitialLoad(initialCount, rows.length))
  }, [windowKey, initialCount, rows.length])

  const max = useMemo(
    () => Math.max(1, ...rows.map((r) => r.value)),
    [rows],
  )
  const visible = rows.slice(0, visibleCount)
  const hasMore = visibleCount < rows.length

  const loadRemaining = useCallback(() => {
    setVisibleCount((cur) => nextRankVisibleCount(cur, rows.length))
  }, [rows.length])

  const onListScroll = useCallback(
    (event: UIEvent<HTMLUListElement>) => {
      if (!hasMore) return
      const el = event.currentTarget
      if (
        el.scrollTop + el.clientHeight >=
        el.scrollHeight - SCROLL_LOAD_THRESHOLD_PX
      ) {
        loadRemaining()
      }
    },
    [hasMore, loadRemaining],
  )

  // 首批撑不满滚动区时直接挂剩余（否则无法滚到尾）
  useLayoutEffect(() => {
    if (!hasMore) return
    const el = listRef.current
    if (!el) return
    if (el.scrollHeight <= el.clientHeight + 1) {
      loadRemaining()
    }
  }, [hasMore, visibleCount, loadRemaining])

  if (rows.length === 0) {
    return <EmptyCard text={emptyText} icon={emptyIcon} loading={loading} />
  }

  const hasSecondary = Boolean(headers.secondary)
  const hasTertiary = Boolean(headers.tertiary) && rows.some((r) => r.tertiary)

  const mods = [
    refreshing ? 'is-refreshing' : '',
    hasSecondary ? 'has-secondary' : '',
    hasTertiary ? 'has-tertiary' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`site-analytics-rank${mods ? ` ${mods}` : ''}`}>
      <div className="site-analytics-rank-head" aria-hidden>
        <span className="site-analytics-rank-h-name">{headers.name}</span>
        {/* 与行内条对齐的空格；叠层时隐藏 */}
        <span className="site-analytics-rank-h-track" />
        <span className="site-analytics-rank-h-value">{headers.value}</span>
        {hasSecondary ? (
          <span className="site-analytics-rank-h-second">{headers.secondary}</span>
        ) : null}
        {hasTertiary ? (
          <span className="site-analytics-rank-h-third">{headers.tertiary}</span>
        ) : null}
      </div>

      <ul
        ref={listRef}
        className="site-analytics-rank-list"
        onScroll={onListScroll}
      >
        {visible.map((row) => {
          const main = formatValue(row.value)
          const aria = [
            row.name,
            headers.value ? `${headers.value} ${main}` : main,
            hasSecondary && row.secondary
              ? `${headers.secondary} ${row.secondary}`
              : null,
            hasTertiary && headers.tertiary && row.tertiary
              ? `${headers.tertiary} ${row.tertiary}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')
          const sub = row.subRows?.filter((s) => s.value > 0) ?? []
          return (
            <li key={row.key} className="site-analytics-rank-item">
              <div className="site-analytics-rank-row" aria-label={aria}>
                <div className="site-analytics-rank-label">
                  <span className="site-analytics-rank-name">{row.name}</span>
                  {row.meta ? (
                    <span className="site-analytics-rank-meta" title={row.meta}>
                      {row.meta}
                    </span>
                  ) : null}
                </div>

                <div className="site-analytics-rank-track" aria-hidden>
                  <div
                    className="site-analytics-rank-bar"
                    style={{
                      width: `${Math.max(1.5, (row.value / max) * 100)}%`,
                    }}
                  />
                </div>

                <span className="site-analytics-rank-value">{main}</span>
                {hasSecondary ? (
                  <span className="site-analytics-rank-second">
                    {row.secondary ?? '—'}
                  </span>
                ) : null}
                {hasTertiary ? (
                  <span className="site-analytics-rank-third">
                    {row.tertiary ?? '—'}
                  </span>
                ) : null}
              </div>
              {sub.length > 0 ? (
                <ul className="site-analytics-rank-sublist">
                  {sub.map((s) => {
                    const sMain = formatValue(s.value)
                    return (
                      <li
                        key={s.key}
                        className="site-analytics-rank-row site-analytics-rank-row--sub"
                        aria-label={`${row.name} · ${s.name} · ${sMain}`}
                      >
                        <div className="site-analytics-rank-label">
                          <span className="site-analytics-rank-name">
                            {s.name}
                          </span>
                        </div>
                        <div className="site-analytics-rank-track" aria-hidden>
                          <div
                            className="site-analytics-rank-bar"
                            style={{
                              width: `${Math.max(1.5, (s.value / max) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="site-analytics-rank-value">
                          {sMain}
                        </span>
                        {hasSecondary ? (
                          <span className="site-analytics-rank-second">
                            {s.secondary ?? '—'}
                          </span>
                        ) : null}
                        {hasTertiary ? (
                          <span className="site-analytics-rank-third">—</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default RankList
