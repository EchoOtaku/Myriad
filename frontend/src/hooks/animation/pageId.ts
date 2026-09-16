const PAGE_ALIASES: Record<string, string> = {
  journal: 'phantasi',
}

/** 第一段之下整棵子路由同一页。 */
export function pageIdFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return 'home'
  if (parts[0] === 'agent' && parts[1] === 'settings') return 'config'
  return PAGE_ALIASES[parts[0]] ?? parts[0]
}
