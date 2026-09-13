import type { CSSProperties } from 'react'

const GHOSTS = [1, 2, 3, 4, 5] as const

function VacantGhost({ i }: { i: number }) {
  return (
    <div
      className="brew-vacant__ghost"
      style={{ '--vacant-i': i } as CSSProperties}
      aria-hidden
    >
      <span className="brew-vacant__shell">
        <span className="brew-vacant__bar is-meta" />
        <span className="brew-vacant__bar is-title" />
        <span className="brew-vacant__bar is-title is-short" />
        <span className="brew-vacant__bar is-line" />
        <span className="brew-vacant__bar is-line" />
        <span className="brew-vacant__bar is-line is-short" />
      </span>
    </div>
  )
}

export function BrewVacant({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div
      className="brew-skin brew-vacant is-arrive"
      data-brew-card="vacant"
      role="status"
    >
      <article className="brew-vacant__note">
        <div className="brew-float brew-vacant__shell">
          <h3 className="brew-vacant__title">{title}</h3>
          {hint ? <p className="brew-vacant__hint">{hint}</p> : null}
        </div>
      </article>
      {GHOSTS.map((i) => (
        <VacantGhost key={i} i={i} />
      ))}
    </div>
  )
}
