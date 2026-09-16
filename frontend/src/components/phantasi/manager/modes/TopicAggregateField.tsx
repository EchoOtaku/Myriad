import type { ReactNode } from 'react'
import type { PhantasiSource } from '../../../../types/phantasi'
import type { ManagedListItem } from '../../../settings/ManagedList'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import {
  getItemPreviews,
  listSubscriptionTopicCatalog,
  setFeedTopicCards,
} from '../../../../services/phantasiApi'
import { InputItem, ManagedList, SettingGroup, SettingGroupGrid } from '../../../settings'
import { SettingTitleTag } from '../../../settings/SettingTitleTag'
import { isInboxFeedSource } from '../../logic/feedStories'
import {
  pickEnabledTopicCards,
  pickTopicCardPreviews,
} from '../../logic/feedTopicCards'
import { topicDisplayName } from '../../logic/topics'
import { noteScheduleLabel } from '../../notes/noteBoard'
import { filterTopicNames } from './addSource'

type TopicPreview = {
  id: number
  title: string
  topic?: string | null
  published_at: number | null
  source_name?: string | null
  source_id?: number
}

export function TopicAggregateField({
  sources = [],
  openName = null,
  onOpen,
  onOpenItem,
}: {
  sources?: readonly PhantasiSource[]
  openName?: string | null
  onOpen?: (name: string | null) => void
  onOpenItem?: (id: number) => void
}) {
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [cards, setCards] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const [articles, setArticles] = useState<TopicPreview[]>([])
  const [pool, setPool] = useState<TopicPreview[]>([])
  const [loadingArticles, setLoadingArticles] = useState(false)

  useEffect(() => {
    let live = true
    void listSubscriptionTopicCatalog()
      .then((catalog) => {
        if (!live) return
        setNames(catalog.topics)
        setCards(catalog.cards)
        setReady(true)
      })
      .catch(() => {
        if (!live) return
        setNames([])
        setCards([])
        setReady(true)
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void getItemPreviews(
      { sort_order: 'desc', per_page: 80 },
      undefined,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return
        setPool(
          page.items.map((item) => ({
            id: item.id,
            title: item.title,
            topic: item.topic,
            published_at: item.published_at,
            source_name: item.source_name,
            source_id: item.source_id,
          })),
        )
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setPool([])
      })
    return () => controller.abort()
  }, [])

  const inboxIds = useMemo(
    () => new Set(sources.filter(isInboxFeedSource).map((source) => source.id)),
    [sources],
  )

  const sourcePreviews = useMemo(() => {
    const items: TopicPreview[] = []
    for (const source of sources) {
      if (!isInboxFeedSource(source)) continue
      for (const item of source.recent_items ?? []) {
        items.push({
          id: item.id,
          title: item.title,
          topic: item.topic,
          published_at: item.published_at,
          source_name: source.name,
          source_id: source.id,
        })
      }
    }
    return items
  }, [sources])

  const previewPool = useMemo(() => {
    const fromApi =
      inboxIds.size > 0
        ? pool.filter(
            (item) => item.source_id == null || inboxIds.has(item.source_id),
          )
        : pool
    return [...fromApi, ...sourcePreviews]
  }, [inboxIds, pool, sourcePreviews])

  useEffect(() => {
    if (!openName) {
      setArticles([])
      setLoadingArticles(false)
      return
    }
    const controller = new AbortController()
    setLoadingArticles(true)
    void getItemPreviews(
      { topic: openName, sort_order: 'desc', per_page: 50 },
      undefined,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return
        setArticles(page.items)
        setLoadingArticles(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setArticles([])
        setLoadingArticles(false)
      })
    return () => controller.abort()
  }, [openName])

  const shown = filterTopicNames(names, query)
  const enabled = new Set(cards)

  const toggle = (name: string, on: boolean) => {
    const next = pickEnabledTopicCards(
      names,
      new Set(on ? [...cards, name] : cards.filter((item) => item !== name)),
    )
    setCards(next)
    void setFeedTopicCards(next)
      .then(setCards)
      .catch(() => {})
  }

  const articleItems = useMemo<ManagedListItem[]>(
    () =>
      articles.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: [item.source_name, noteScheduleLabel(item.published_at, locale)]
          .filter(Boolean)
          .join(' · '),
        renderHit: ({
          leading,
          main,
        }: {
          leading: ReactNode
          main: ReactNode
        }) => (
          <button
            type="button"
            className="managed-list-row-hit"
            onClick={() => onOpenItem?.(item.id)}
          >
            {leading}
            {main}
          </button>
        ),
      })),
    [articles, locale, onOpenItem],
  )

  if (openName) {
    return (
      <ManagedList
        queryCollapsible={false}
        queryChrome="plain"
        loading={loadingArticles && articles.length === 0}
        items={articleItems}
        emptyText={t.phantasi.noArticles}
        maxHeight={null}
      />
    )
  }

  return (
    <div className="phantasi-add-form__stack">
      <InputItem
        itemKey="phantasi-add-topic"
        size="sm"
        label={t.phantasi.topicNone}
        value={query}
        onChange={setQuery}
        placeholder={t.phantasi.topicSearchPlaceholder}
        inputType="search"
        autoComplete="off"
      />
      {shown.length > 0 ? (
        <SettingGroupGrid
          columns={3}
          variant="card"
          align="rows"
          minColumnWidth="11rem"
          className="phantasi-workbench__topic-grid"
        >
          {shown.map((name) => {
            const previews = pickTopicCardPreviews(name, previewPool)
            return (
              <div
                key={name}
                className="phantasi-workbench__topic-hit"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  if (
                    (event.target as HTMLElement).closest(
                      '.setting-group-header-switch',
                    )
                  ) {
                    return
                  }
                  onOpen?.(name)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  if (
                    (event.target as HTMLElement).closest(
                      '.setting-group-header-switch',
                    )
                  ) {
                    return
                  }
                  event.preventDefault()
                  onOpen?.(name)
                }}
              >
                <SettingGroup
                  title={topicDisplayName({ key: name }, t.phantasi)}
                  toc={false}
                  switch={{
                    checked: enabled.has(name),
                    onChange: (on) => toggle(name, on),
                    ariaLabel: t.phantasi.topicFeedCard,
                  }}
                >
                  {previews.length > 0 ? (
                    <ul className="phantasi-workbench__topic-preview">
                      {previews.map((item) => (
                        <li key={item.id}>{item.title}</li>
                      ))}
                    </ul>
                  ) : null}
                </SettingGroup>
              </div>
            )
          })}
        </SettingGroupGrid>
      ) : ready && names.length === 0 ? (
        <SettingTitleTag variant="muted">{t.phantasi.noContent}</SettingTitleTag>
      ) : null}
    </div>
  )
}
