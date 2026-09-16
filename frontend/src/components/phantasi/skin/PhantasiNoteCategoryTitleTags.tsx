import type { PhantasiNoteDoc, PhantasiSource } from '../../../types/phantasi'
import type { HomeBoardNote } from '../logic/homeBoard'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { SettingTitleTag } from '../../settings/SettingTitleTag'
import { leftoverNoteSources, sourceLatestStory } from '../notes/noteBoard'
import {
  collectNoteCategories,
  NOTE_CATEGORY_NONE,
  noteBoardHasUnfiled,
  noteStoryTopic,
} from '../notes/noteCategory'

const TAG = 'phantasi-feeds__title-tag'

export function useNoteBoardCategory(
  notes: readonly HomeBoardNote[],
  docs: readonly PhantasiNoteDoc[],
  sources: readonly PhantasiSource[],
  pending = false,
) {
  const categories = useMemo(
    () => collectNoteCategories([...notes, ...docs]),
    [docs, notes],
  )
  const leftoverTopics = useMemo(
    () =>
      leftoverNoteSources(sources, notes).map(
        (source) => sourceLatestStory(source)?.topic ?? null,
      ),
    [notes, sources],
  )
  const hasUnfiled = useMemo(
    () =>
      noteBoardHasUnfiled([
        ...notes,
        ...docs,
        ...leftoverTopics.map((topic) => ({ topic })),
      ]),
    [docs, leftoverTopics, notes],
  )
  const [filter, setFilter] = useState<string | null>(null)
  useEffect(() => {
    if (!pending && filter && filter !== NOTE_CATEGORY_NONE && !categories.includes(filter)) {
      setFilter(null)
    }
  }, [categories, filter, pending])
  return { categories, hasUnfiled, filter, setFilter }
}

export function PhantasiNoteCategoryTitleTags({
  categories,
  hasUnfiled,
  value,
  onChange,
}: {
  categories: readonly string[]
  hasUnfiled: boolean
  value: string | null
  onChange: (next: string | null) => void
}) {
  const { t } = useI18n()
  const labels = t.phantasi
  if (categories.length === 0) return null

  return (
    <div
      className="phantasi-rail-title__tags"
      role="group"
      aria-label={labels.noteTopic}
    >
      <SettingTitleTag
        className={TAG}
        variant={value == null ? 'default' : 'muted'}
        onClick={() => onChange(null)}
      >
        {labels.noteCategoryAll}
      </SettingTitleTag>
      {categories.map((name) => (
        <SettingTitleTag
          key={name}
          className={TAG}
          variant={value === name ? 'default' : 'muted'}
          onClick={() => onChange(name)}
        >
          {noteStoryTopic(name, labels).topic ?? name}
        </SettingTitleTag>
      ))}
      {hasUnfiled ? (
        <SettingTitleTag
          className={TAG}
          variant={value === NOTE_CATEGORY_NONE ? 'default' : 'muted'}
          onClick={() => onChange(NOTE_CATEGORY_NONE)}
        >
          {labels.noteTopicNone}
        </SettingTitleTag>
      ) : null}
    </div>
  )
}
