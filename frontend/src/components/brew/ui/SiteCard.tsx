/** 不认识 brew_sources。 */

import type { CSSProperties } from 'react'

import { LuEdit3 as Edit3 } from '@lib/icons'

import { memo } from 'react'
import { cx } from './cx'
import { BrewPick } from './Pick'

function SiteCardInner({
  id,
  name,
  description,
  icon,
  unread,
  latestTitle,
  latestWhen,
  on,
  cover,
  editing,
  picked,
  ink,
  emptyLabel,
  editLabel,
  onActivate,
  onOpenLatest,
  onEdit,
  onIconLoad,
  arrive,
}: {
  id: number | string
  name: string
  description?: string
  icon?: string | null
  unread?: number
  latestTitle?: string
  latestWhen?: string
  on?: boolean
  cover?: string | null
  editing?: boolean
  picked?: boolean
  ink?: string | null
  emptyLabel: string
  editLabel?: string
  onActivate: (id: number | string) => void
  onOpenLatest?: (id: number | string) => void
  onEdit?: (id: number | string) => void
  onIconLoad?: (img: HTMLImageElement) => void
  arrive?: number
}) {
  return (
    <div
      data-rail-id={id}
      data-brew-surface="site"
      className={cx(
        'brew-site',
        on && 'is-on',
        cover && 'is-cover',
        editing && 'is-edit',
        picked && 'is-picked',
        arrive != null && 'is-arrive',
      )}
      style={
        {
          '--site-ink': ink,
          ...(arrive != null ? { '--brew-card-i': arrive } : null),
        } as CSSProperties
      }
      onClick={() => onActivate(id)}
    >
      {cover ? (
        <span className="brew-site__scene" aria-hidden>
          <img key={cover} src={cover} alt="" decoding="async" />
        </span>
      ) : icon ? (
        <span className="brew-site__bleed" aria-hidden>
          <img
            src={icon}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
            onLoad={(event) => onIconLoad?.(event.currentTarget)}
          />
        </span>
      ) : null}
      {editing ? <BrewPick on={!!picked} /> : null}
      {editing && onEdit ? (
        <button
          type="button"
          className="brew-site__edit"
          title={editLabel}
          aria-label={editLabel}
          onClick={(event) => {
            event.stopPropagation()
            onEdit(id)
          }}
        >
          <Edit3 />
        </button>
      ) : null}
      {unread && unread > 0 ? (
        <span className="brew-site__unread">{unread > 99 ? '99+' : unread}</span>
      ) : null}
      <button
        type="button"
        className="brew-site__head"
        onClick={() => onActivate(id)}
        aria-pressed={on}
      >
        <span className="brew-site__name">{name}</span>
        {!cover && description ? (
          <span className="brew-site__dek">{description}</span>
        ) : null}
      </button>
      {cover ? null : latestTitle ? (
        <button
          type="button"
          className="brew-site__article"
          onClick={(event) => {
            event.stopPropagation()
            onOpenLatest?.(id)
          }}
        >
          <span className="brew-site__article-title">{latestTitle}</span>
          {latestWhen ? (
            <span className="brew-site__when">{latestWhen}</span>
          ) : null}
        </button>
      ) : (
        <span className="brew-site__none">{emptyLabel}</span>
      )}
    </div>
  )
}

export const SiteCard = memo(SiteCardInner)
SiteCard.displayName = 'SiteCard'

export function SiteMark({
  name,
  icon,
}: {
  name: string
  icon?: string | null
}) {
  return (
    <span className="brew-mark" aria-hidden>
      {icon ? (
        <img
          src={icon}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  )
}
