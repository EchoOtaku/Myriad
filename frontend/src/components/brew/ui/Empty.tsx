import type { CSSProperties } from 'react'
import { BrewRailTitle } from './BrewRailTitle'

const STORY_GHOSTS = [1, 2, 3, 4, 5] as const
const SITE_GHOSTS = [1, 2, 3, 4, 5] as const
const FRIEND_STORY_GHOSTS = [1, 2, 3] as const

function StoryGhost({ i, compact = false }: { i: number; compact?: boolean }) {
  return (
    <div
      className="brew-vacant__ghost"
      style={{ '--vacant-i': i } as CSSProperties}
      aria-hidden
    >
      <span className="brew-vacant__shell">
        <span className="brew-vacant__bar is-meta" />
        <span className="brew-vacant__bar is-title" />
        {compact ? null : (
          <>
            <span className="brew-vacant__bar is-title is-short" />
            <span className="brew-vacant__bar is-line" />
            <span className="brew-vacant__bar is-line" />
            <span className="brew-vacant__bar is-line is-short" />
          </>
        )}
      </span>
    </div>
  )
}

function SiteGhost({ i }: { i: number }) {
  return (
    <div
      className="brew-vacant__ghost is-site"
      style={{ '--vacant-i': i } as CSSProperties}
      aria-hidden
    >
      <span className="brew-vacant__shell">
        <span className="brew-vacant__bar is-name" />
        <span className="brew-vacant__bar is-article" />
      </span>
    </div>
  )
}

export function BrewVacant({
  title,
  hint,
  articleTitle,
  layout = 'articles',
}: {
  title: string
  hint?: string
  articleTitle?: string
  layout?: 'articles' | 'friends'
}) {
  if (layout === 'friends') {
    return (
      <div
        className="brew-skin brew-vacant is-friends is-arrive"
        data-brew-surface="vacant"
        data-brew-card="vacant"
        role="status"
      >
        <div className="brew-vacant__sites">
          <article className="brew-vacant__note is-site">
            <div className="brew-float brew-vacant__shell">
              <h3 className="brew-vacant__title">{title}</h3>
              {hint ? <p className="brew-vacant__hint">{hint}</p> : null}
            </div>
          </article>
          {SITE_GHOSTS.map((i) => (
            <SiteGhost key={i} i={i} />
          ))}
        </div>
        {articleTitle ? (
          <BrewRailTitle arrive={false}>{articleTitle}</BrewRailTitle>
        ) : null}
        <div
          className="brew-vacant__items"
          style={
            {
              '--brew-story-cols': Math.ceil(FRIEND_STORY_GHOSTS.length / 2),
            } as CSSProperties
          }
        >
          {FRIEND_STORY_GHOSTS.map((i) => (
            <StoryGhost key={i} i={i} compact />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="brew-skin brew-vacant is-arrive"
      data-brew-surface="vacant"
      data-brew-card="vacant"
      role="status"
      style={
        {
          '--brew-story-cols': Math.ceil((1 + STORY_GHOSTS.length) / 2),
        } as CSSProperties
      }
    >
      <article className="brew-vacant__note">
        <div className="brew-float brew-vacant__shell">
          <h3 className="brew-vacant__title">{title}</h3>
          {hint ? <p className="brew-vacant__hint">{hint}</p> : null}
        </div>
      </article>
      {STORY_GHOSTS.map((i) => (
        <StoryGhost key={i} i={i} />
      ))}
    </div>
  )
}
