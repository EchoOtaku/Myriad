import type { BrewSource } from '../../../types/brew'

import { BrewSearch } from '../ui/BrewSearch'

interface BrewControlsProps {
  sources: BrewSource[]
  filteredSources: BrewSource[]
  categories: string[]
  searchQuery?: string
  setSearchQuery?: (query: string) => void
  isAdmin?: boolean
}

export default function BrewControls({
  filteredSources,
  searchQuery = '',
  setSearchQuery,
}: BrewControlsProps) {
  return (
    <BrewSearch
      value={searchQuery}
      onChange={setSearchQuery}
      matchCount={filteredSources.length}
    />
  )
}
