import type { PhantasiSource } from '../../../types/phantasi'

import { PhantasiSearch } from '../ui/PhantasiSearch'

interface PhantasiControlsProps {
  sources: PhantasiSource[]
  filteredSources: PhantasiSource[]
  categories: string[]
  searchQuery?: string
  setSearchQuery?: (query: string) => void
  isAdmin?: boolean
}

export default function PhantasiControls({
  filteredSources,
  searchQuery = '',
  setSearchQuery,
}: PhantasiControlsProps) {
  return (
    <PhantasiSearch
      value={searchQuery}
      onChange={setSearchQuery}
      matchCount={filteredSources.length}
    />
  )
}
