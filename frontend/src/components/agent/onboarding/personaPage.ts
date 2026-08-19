export const PERSONA_PAGE = 'persona'

export function isPersonaPageOpen(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('page') === PERSONA_PAGE
}

export function setPersonaPageOpen(open: boolean) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (open) url.searchParams.set('page', PERSONA_PAGE)
  else url.searchParams.delete('page')
  window.history.pushState(window.history.state, '', url.toString())
}
