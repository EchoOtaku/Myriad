export const AGENT_SETTINGS_PATH = '/agent/settings'

export type AgentSettingsPage = 'merope' | 'merope-setup'

export function isAgentSettingsPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === AGENT_SETTINGS_PATH || path.startsWith(`${AGENT_SETTINGS_PATH}/`)
}

export function agentSettingsPath(options?: {
  page?: string | null
  guidePath?: string | null
}): string {
  const params = new URLSearchParams()
  if (options?.page === 'merope' || options?.page === 'merope-setup') {
    params.set('page', options.page)
  }
  const guide = options?.guidePath?.trim()
  if (guide) params.set('guide', guide)
  const qs = params.toString()
  return qs ? `${AGENT_SETTINGS_PATH}?${qs}` : AGENT_SETTINGS_PATH
}

/** 旧管理台深链：?section=agent 或 ?page=merope* → Agent 设置。 */
export function agentSettingsRedirectFromSearch(search: string): string | null {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  )
  const page = params.get('page')
  if (page === 'merope' || page === 'merope-setup') {
    return agentSettingsPath({
      page,
      guidePath: params.get('guide'),
    })
  }
  if (params.get('section') === 'agent') {
    return agentSettingsPath({ guidePath: params.get('guide') })
  }
  return null
}
