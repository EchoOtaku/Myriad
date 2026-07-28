/**
 * Generic list-management panel for settings pages.
 *
 * Layout: optional stat chips → toolbar → scrollable rows with badge + actions.
 * Callers own data; this only renders structure and wires clicks. Prefer
 * optimistic row updates at the call site so delete/cancel never need a full
 * page refresh.
 */

import type { ReactNode } from 'react'
import React, { useCallback } from 'react'
import { Spinner } from '../Spinner'
import './ManagedList.css'

export type ManagedListTone =
  | 'default'
  | 'active'
  | 'success'
  | 'warn'
  | 'danger'
  | 'muted'

export type ManagedListButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'ghost'

export interface ManagedListStat {
  key: string
  label: string
  value: number | string
  tone?: ManagedListTone
}

export interface ManagedListAction {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  variant?: ManagedListButtonVariant
  /** Optional window.confirm message before onClick. */
  confirm?: string
  /** Accessible name when label is short. */
  ariaLabel?: string
  /** Native title / tooltip (e.g. why a button is disabled). */
  title?: string
}

export interface ManagedListItem {
  id: string | number
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  badge?: { label: string; tone?: ManagedListTone }
  /** Optional leading slot (icon / avatar). */
  leading?: ReactNode
  /**
   * Optional control between main text and action buttons
   * (e.g. FieldSelect for trust level).
   */
  trailing?: ReactNode
  actions?: ManagedListAction[]
  /** Dim row + block pointer while this row’s action runs. */
  busy?: boolean
  className?: string
}

export interface ManagedListProps {
  /** Compact counters above the list (pending / dead / …). */
  stats?: ManagedListStat[]
  /** Bulk / refresh actions. */
  toolbar?: ManagedListAction[]
  items: ManagedListItem[]
  emptyText: string
  /** Initial list fetch / full refresh spinner over the body. */
  loading?: boolean
  /** Soft working state (bulk action) without blanking the list. */
  working?: boolean
  /**
   * Body max height. Pass `null` / `'none'` to grow with content
   * (short settings lists). Default scrolls at 18rem.
   */
  maxHeight?: string | number | null
  className?: string
  /** Optional footer (e.g. “showing N of M”). */
  footer?: ReactNode
}

function toneClass(tone: ManagedListTone | undefined, prefix: string): string {
  return `${prefix} ${prefix}--${tone ?? 'default'}`
}

function actionBtnClass(variant: ManagedListButtonVariant | undefined): string {
  switch (variant) {
    case 'primary':
      return 'managed-list-btn managed-list-btn--primary'
    case 'danger':
      return 'managed-list-btn managed-list-btn--danger'
    case 'ghost':
      return 'managed-list-btn managed-list-btn--ghost'
    case 'secondary':
    default:
      return 'managed-list-btn managed-list-btn--secondary'
  }
}

const ListActionButton = React.memo(function ListActionButton({
  action,
  size = 'md',
}: {
  action: ManagedListAction
  size?: 'sm' | 'md'
}) {
  const handle = useCallback(() => {
    if (action.disabled || action.loading) return
    if (action.confirm && !window.confirm(action.confirm)) return
    action.onClick()
  }, [action])

  return (
    <button
      type="button"
      className={`${actionBtnClass(action.variant)}${size === 'sm' ? ' managed-list-btn--sm' : ''}`}
      disabled={action.disabled || action.loading}
      aria-busy={action.loading || undefined}
      aria-label={action.ariaLabel ?? action.label}
      title={action.title}
      onClick={handle}
    >
      {action.loading ? (
        <Spinner size="xs" color="current" />
      ) : (
        <span>{action.label}</span>
      )}
    </button>
  )
})

export const ManagedList = React.memo(function ManagedList({
  stats,
  toolbar,
  items,
  emptyText,
  loading = false,
  working = false,
  maxHeight = '18rem',
  className = '',
  footer,
}: ManagedListProps) {
  const constrain =
    maxHeight != null && maxHeight !== 'none' && maxHeight !== ''
  const heightStyle = constrain
    ? typeof maxHeight === 'number'
      ? `${maxHeight}px`
      : String(maxHeight)
    : undefined

  return (
    <div
      className={`managed-list${working ? ' is-working' : ''}${className ? ` ${className}` : ''}`}
    >
      {stats && stats.length > 0 && (
        <div className="managed-list-stats" role="group" aria-label="stats">
          {stats.map((s) => (
            <div
              key={s.key}
              className={toneClass(s.tone, 'managed-list-stat')}
            >
              <span className="managed-list-stat-value">{s.value}</span>
              <span className="managed-list-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {toolbar && toolbar.length > 0 && (
        <div className="managed-list-toolbar" role="toolbar">
          {toolbar.map((a) => (
            <ListActionButton key={a.key} action={a} />
          ))}
        </div>
      )}

      <div
        className={`managed-list-body${constrain ? ' is-scroll' : ''}`}
        style={heightStyle ? { maxHeight: heightStyle } : undefined}
        role="list"
      >
        {loading && items.length === 0 ? (
          <div className="managed-list-empty" role="status">
            <Spinner size="sm" color="primary" />
          </div>
        ) : items.length === 0 ? (
          <div className="managed-list-empty" role="status">
            {emptyText}
          </div>
        ) : (
          items.map((item) => {
            const hasActions = !!(item.actions && item.actions.length > 0)
            const hasTrailing = item.trailing != null
            return (
              <div
                key={item.id}
                role="listitem"
                className={`managed-list-row${item.busy ? ' is-busy' : ''}${item.className ? ` ${item.className}` : ''}`}
                aria-busy={item.busy || undefined}
              >
                {item.leading != null && (
                  <div className="managed-list-row-leading">{item.leading}</div>
                )}
                <div className="managed-list-row-main">
                  <div className="managed-list-row-title-line">
                    {item.badge && (
                      <span
                        className={toneClass(
                          item.badge.tone,
                          'managed-list-badge',
                        )}
                      >
                        {item.badge.label}
                      </span>
                    )}
                    <div className="managed-list-row-title">{item.title}</div>
                  </div>
                  {item.subtitle != null && item.subtitle !== '' && (
                    <div className="managed-list-row-subtitle">
                      {item.subtitle}
                    </div>
                  )}
                  {item.meta != null && item.meta !== '' && (
                    <div className="managed-list-row-meta">{item.meta}</div>
                  )}
                </div>
                {(hasTrailing || hasActions) && (
                  <div className="managed-list-row-side">
                    {hasTrailing && (
                      <div className="managed-list-row-trailing">
                        {item.trailing}
                      </div>
                    )}
                    {hasActions && (
                      <div className="managed-list-row-actions">
                        {item.actions!.map((a) => (
                          <ListActionButton
                            key={a.key}
                            action={{
                              ...a,
                              disabled: a.disabled || item.busy,
                              loading: a.loading,
                            }}
                            size="sm"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {footer != null && <div className="managed-list-footer">{footer}</div>}
    </div>
  )
})

export default ManagedList
