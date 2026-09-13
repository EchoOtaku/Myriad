import type { AddSourceInput, BrewSource } from '../../../types/brew'

import { useCallback, useEffect } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { userFacingError } from '../../../utils/userFacingError'
import { useSetFeedsAddForm } from '../ui/BrewFeedsPanel'
import { BrewSearch } from '../ui/BrewSearch'
import { AddMode } from './modes'
import { toAddSourceInput } from './modes/addSource'
import RSSHubConfigComponent from './RSSHubConfig'
import { useBrewpack } from './useBrewpack'

interface BrewControlsProps {
  sources: BrewSource[]
  filteredSources: BrewSource[]
  categories: string[]
  searchQuery?: string
  setSearchQuery?: (query: string) => void
  onAddSource?: (input: AddSourceInput) => Promise<void>
  onDiscover?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{
    url: string
    title: string
    feed_type: string
    autocompleted: boolean
  } | null>
  onImportOpml?: (
    content: string,
    signal?: AbortSignal,
  ) => Promise<{ imported: number; skipped: number }>
  onSourcesChange?: () => void
  isAdmin?: boolean
}

export default function BrewControls({
  sources,
  filteredSources,
  categories,
  searchQuery = '',
  setSearchQuery,
  onAddSource,
  onDiscover,
  onImportOpml,
  onSourcesChange,
  isAdmin = false,
}: BrewControlsProps) {
  const { t } = useI18n()
  const setAddForm = useSetFeedsAddForm()
  const pack = useBrewpack(sources, onSourcesChange)
  const allAddCategories = Iterator.from(
    new Set([t.brew.friendLinks, t.brew.me]).union(new Set(categories)),
  ).toArray()
  const categoryKey = allAddCategories.join('\0')

  const handleAddSubmit = useCallback(
    async (data: Parameters<typeof toAddSourceInput>[0]) => {
      if (!onAddSource) return { success: false as const }
      try {
        await onAddSource(toAddSourceInput(data))
        return { success: true as const }
      } catch (err) {
        return {
          success: false as const,
          error: userFacingError(err, t.brew.errorAddFailed),
        }
      }
    },
    [onAddSource, t.brew.errorAddFailed],
  )

  useEffect(() => {
    if (!onAddSource || !isAdmin) {
      setAddForm(null)
      return
    }
    const nextCategories = Iterator.from(
      new Set([t.brew.friendLinks, t.brew.me]).union(new Set(categories)),
    ).toArray()
    setAddForm(
      <AddMode
        allCategories={nextCategories}
        sourcesCount={sources.length}
        onSubmit={handleAddSubmit}
        onDiscover={onDiscover}
        onImportOpml={onImportOpml}
        onExportOpml={pack.exportOpml}
        RSSHubConfigComponent={RSSHubConfigComponent}
      />,
    )
    return () => setAddForm(null)
  }, [
    categories,
    categoryKey,
    handleAddSubmit,
    isAdmin,
    onAddSource,
    onDiscover,
    onImportOpml,
    pack.exportOpml,
    setAddForm,
    sources.length,
    t.brew.friendLinks,
    t.brew.me,
  ])

  return (
    <BrewSearch
      value={searchQuery}
      onChange={setSearchQuery}
      matchCount={filteredSources.length}
    />
  )
}
