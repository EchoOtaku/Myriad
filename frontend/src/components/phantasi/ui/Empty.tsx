import type { CSSProperties } from 'react'
import { PhantasiRailTitle } from './PhantasiRailTitle'

const STORY_GHOSTS = [1, 2, 3, 4, 5] as const
const SITE_GHOSTS = [1, 2, 3, 4, 5] as const
const FRIEND_STORY_GHOSTS = [1, 2, 3, 4] as const

function StoryGhost({ i }: { i: number }) {
  return (
    <div
      className="phantasi-vacant__ghost"
      style={{ '--vacant-i': i } as CSSProperties}
      aria-hidden
    >
      <span className="phantasi-vacant__shell">
        <span className="phantasi-vacant__bar is-meta" />
        <span className="phantasi-vacant__bar is-title" />
        <span className="phantasi-vacant__bar is-title is-short" />
        <span className="phantasi-vacant__bar is-line" />
        <span className="phantasi-vacant__bar is-line" />
        <span className="phantasi-vacant__bar is-line is-short" />
      </span>
    </div>
  )
}

function SiteGhost({ i }: { i: number }) {
  return (
    <div
      className="phantasi-vacant__ghost is-site"
      style={{ '--vacant-i': i } as CSSProperties}
      aria-hidden
    >
      <span className="phantasi-vacant__shell">
        <span className="phantasi-vacant__bar is-name" />
        <span className="phantasi-vacant__bar is-article" />
      </span>
    </div>
  )
}

export function PhantasiVacant({
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
        className="phantasi-skin phantasi-vacant is-friends is-arrive"
        data-phantasi-surface="vacant"
        data-phantasi-card="vacant"
        role="status"
      >
        <div className="phantasi-vacant__sites">
          <article className="phantasi-vacant__note is-site">
            <div className="phantasi-float phantasi-vacant__shell">
              <h3 className="phantasi-vacant__title">{title}</h3>
              {hint ? <p className="phantasi-vacant__hint">{hint}</p> : null}
            </div>
          </article>
          {SITE_GHOSTS.map((i) => (
            <SiteGhost key={i} i={i} />
          ))}
        </div>
        {articleTitle ? (
          <PhantasiRailTitle arrive={false}>{articleTitle}</PhantasiRailTitle>
        ) : null}
        <div
          className="phantasi-vacant__items"
          style={
            {
              '--phantasi-story-cols': FRIEND_STORY_GHOSTS.length,
            } as CSSProperties
          }
        >
          {FRIEND_STORY_GHOSTS.map((i) => (
            <StoryGhost key={i} i={i} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="phantasi-skin phantasi-vacant is-arrive"
      data-phantasi-surface="vacant"
      data-phantasi-card="vacant"
      role="status"
      style={
        {
          '--phantasi-story-cols': Math.ceil((1 + STORY_GHOSTS.length) / 2),
        } as CSSProperties
      }
    >
      <article className="phantasi-vacant__note">
        <div className="phantasi-float phantasi-vacant__shell">
          <h3 className="phantasi-vacant__title">{title}</h3>
          {hint ? <p className="phantasi-vacant__hint">{hint}</p> : null}
        </div>
      </article>
      {STORY_GHOSTS.map((i) => (
        <StoryGhost key={i} i={i} />
      ))}
    </div>
  )
}
