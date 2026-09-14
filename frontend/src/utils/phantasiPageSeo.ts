import type { PhantasiItem, PhantasiSource } from '../types/phantasi'
import type { PageSeoInput } from './siteMetadata'
import {
  phantasiOwnItemPath,
  isOwnPhantasiSource,
} from '../components/phantasi/constants'
import { buildModulePageSeo } from './modulePageSeo'
import { formatPageTitle } from './siteMetadata'

function plainTextSnippet(
  htmlOrText: string | null | undefined,
  maxLen = 160,
): string | undefined {
  if (!htmlOrText) return undefined
  const plain = htmlOrText
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll(/\s+/g, ' ')
    .trim()
  if (!plain) return undefined
  if (plain.length <= maxLen) return plain
  return `${plain.slice(0, maxLen - 1).trimEnd()}…`
}

function pickItemImage(item: PhantasiItem): string | undefined {
  const raw = item.image?.trim()
  if (!raw || raw.startsWith('data:')) return undefined
  return raw
}

export function buildPhantasiListPageSeo(opts: {
  listLabel: string
  listDescription?: string
  moduleOpenToAll: boolean
}): PageSeoInput {
  return buildModulePageSeo({
    label: opts.listLabel,
    description: opts.listDescription,
    path: '/phantasi',
    moduleOpenToAll: opts.moduleOpenToAll,
  })
}

export function buildPhantasiItemPageSeo(opts: {
  item: PhantasiItem
  source: PhantasiSource | null | undefined
  moduleOpenToAll: boolean
}): PageSeoInput {
  const { item, source, moduleOpenToAll } = opts
  const own = isOwnPhantasiSource(source)
  const title = formatPageTitle(item.title || 'Phantasi')
  const description =
    plainTextSnippet(item.summary) ||
    plainTextSnippet(item.content) ||
    undefined

  if (own && moduleOpenToAll) {
    return {
      title,
      description,
      image: pickItemImage(item),
      path: phantasiOwnItemPath(item.id),
      noindex: false,
    }
  }

  return {
    title,
    description,
    path: '/phantasi',
    noindex: true,
  }
}
