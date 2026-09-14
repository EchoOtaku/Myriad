import type { AddFieldKind } from './addSource'
import type { BrewSource, RSSHubConfig } from '../../../../types/brew'
import type { EditFieldKind, SubscriptionMode } from './editSource'
import { LuSearch as Search, LuSparkles as Sparkles } from '@lib/icons'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { userFacingError } from '../../../../utils/userFacingError'
import { CompactSettingGroup } from '../../../settings/CompactSettingGroup'
import { InputItem } from '../../../settings/items/InputItem'
import { SelectItem } from '../../../settings/items/SelectItem'
import { SettingsButton } from '../../../settings/items/SettingsButton'
import { SwitchItem } from '../../../settings/items/SwitchItem'
import { SettingTitleTag } from '../../../settings/SettingTitleTag'
import { Spinner } from '../../../Spinner'
import {
  getIconUrl,
  isFriendLinkCategory,
  isMineCategory,
  PRESET_CATEGORY_DB_VALUES,
} from '../../constants'
import { RequestTurn, unlessAborted } from '../../logic/requestTurn'
import RSSHubConfigComponent from '../RSSHubConfig'
import {
  addUrlLabelKey,
  addUrlPlaceholder,
} from './addSource'
import {
  canSubmitEdit,
  EDIT_INTERVALS,
  editFieldKind,
  pickEditKind,
  resolveEditSourcePayload,
} from './editSource'
import { SourceCategoryField } from './SourceCategoryField'
import { SourceKindControl } from './SourceKindControl'
import './AddMode.css'

interface EditSourceModeProps {
  source: BrewSource
  categories: string[]
  onSave: (
    id: number,
    data: ReturnType<typeof resolveEditSourcePayload>,
  ) => Promise<void>
  onGenerateStyleTags?: (
    sourceId: number,
    signal?: AbortSignal,
  ) => Promise<{ success: boolean; tags?: string[] }>
  onDiscover?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{
    url: string
    autocompleted: boolean
    title: string
    feed_type: string
  } | null>
}

function categoryLabel(
  cat: string,
  labels: { friendLinks: string; me: string },
): string {
  if (isFriendLinkCategory(cat)) return labels.friendLinks
  if (isMineCategory(cat)) return labels.me
  return cat
}

function TagEditor({
  itemKey,
  label,
  description,
  draft,
  onDraft,
  placeholder,
  tags,
  empty,
  deleteLabel,
  disabled,
  accessory,
  onAdd,
  onRemove,
}: {
  itemKey: string
  label: string
  description: string
  draft: string
  onDraft: (value: string) => void
  placeholder: string
  tags: readonly string[]
  empty: string
  deleteLabel: string
  disabled: boolean
  accessory: ReactNode
  onAdd: () => void
  onRemove: (tag: string) => void
}) {
  return (
    <>
      <div
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          onAdd()
        }}
      >
        <InputItem
          itemKey={itemKey}
          size="sm"
          label={label}
          description={description}
          value={draft}
          onChange={onDraft}
          placeholder={placeholder}
          disabled={disabled}
          labelAccessory={accessory}
        />
      </div>
      <div className="brew-add-form__tags">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <SettingTitleTag
              key={tag}
              onDismiss={() => onRemove(tag)}
              dismissAriaLabel={deleteLabel}
            >
              {tag}
            </SettingTitleTag>
          ))
        ) : (
          <SettingTitleTag variant="muted">{empty}</SettingTitleTag>
        )}
      </div>
    </>
  )
}

export function EditSourceMode({
  source,
  categories,
  onSave,
  onGenerateStyleTags,
  onDiscover,
}: EditSourceModeProps) {
  const { t } = useI18n()
  const brew = t.brew
  const generateTurns = useRef(new RequestTurn())
  const discoverTurns = useRef(new RequestTurn())
  useEffect(
    () => () => {
      generateTurns.current.cancel()
      discoverTurns.current.cancel()
    },
    [],
  )
  const originalKind = editFieldKind(source)
  const [fieldKind, setFieldKind] = useState<EditFieldKind>(originalKind)
  const [name, setName] = useState(source.name)
  const [category, setCategory] = useState(source.category?.trim() ?? '')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [url, setUrl] = useState(source.url)
  const [notionToken, setNotionToken] = useState('')
  const [rsshubFullUrl, setRsshubFullUrl] = useState('')
  const [rsshubRoute, setRsshubRoute] = useState(source.rsshub_route ?? '')
  const [discovering, setDiscovering] = useState(false)
  const [updateInterval, setUpdateInterval] = useState(source.update_interval)
  const [icon, setIcon] = useState(
    () => getIconUrl(source.icon) ?? source.icon ?? '',
  )
  const [iconDirty, setIconDirty] = useState(false)
  const [themeColor, setThemeColor] = useState(source.theme_color || '')
  const [paused, setPaused] = useState(!source.enabled)
  const [brewliaOn, setBrewliaOn] = useState(source.source_type === 'brewlia')
  const [styleTags, setStyleTags] = useState(source.ai_style_tags || [])
  const [newTag, setNewTag] = useState('')
  const [generatingTags, setGeneratingTags] = useState(false)
  const [adminOnly, setAdminOnly] = useState(source.admin_only)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLink = fieldKind === 'link'
  const isNote = fieldKind === 'note'
  const showMode = !isLink && !isNote
  const subscriptionMode: SubscriptionMode = paused
    ? 'disabled'
    : brewliaOn
      ? 'brewlia'
      : 'normal'
  const showInterval = showMode && !paused
  const showAiTags = showMode && !paused && brewliaOn
  const showCustomTags = isLink
  const allCategories = useMemo(
    () =>
      Iterator.from(
        new Set(PRESET_CATEGORY_DB_VALUES).union(new Set(categories)),
      ).toArray(),
    [categories],
  )
  const intervalLabels: Record<number, string> = {
    15: brew.interval15min,
    30: brew.interval30min,
    60: brew.interval1hour,
    120: brew.interval2hour,
    360: brew.interval6hour,
    720: brew.interval12hour,
    1440: brew.intervalDaily,
  }
  const presetLabels = { friendLinks: brew.friendLinks, me: brew.me }

  const changeIcon = (value: string) => {
    setIcon(value)
    setIconDirty(true)
    if (value) setThemeColor('')
  }

  const addTag = () => {
    const tag = newTag.trim()
    if (!tag || styleTags.includes(tag) || styleTags.length >= 3) return
    setStyleTags((prev) => [...prev, tag])
    setNewTag('')
  }

  const pickKind = (next: AddFieldKind) => {
    const picked = pickEditKind(next)
    setFieldKind(next)
    if (picked.clearUrl) {
      setUrl('')
      setRsshubFullUrl('')
    } else if (!url.trim()) {
      setUrl(source.url)
    }
    if (next === 'link') setBrewliaOn(false)
    if (next !== 'notion') setNotionToken('')
  }

  const handleDiscover = async () => {
    if (!onDiscover || !url.trim()) return
    const signal = discoverTurns.current.begin()
    setDiscovering(true)
    setError(null)
    try {
      const result = await onDiscover(url, signal)
      unlessAborted(signal, () => {
        if (result?.url) {
          setUrl(result.url)
          if (result.title && !name.trim()) setName(result.title)
        }
      })
    } catch (err) {
      unlessAborted(signal, () => {
        setError(userFacingError(err, brew.errorDiscoverFailed))
      })
    } finally {
      unlessAborted(signal, () => setDiscovering(false))
    }
  }

  const canSubmit = canSubmitEdit({
    fieldKind,
    originalKind,
    url: fieldKind === 'rsshub' ? rsshubFullUrl || url : url,
    name,
    rsshubFullUrl,
    notionToken,
  })

  const handleSave = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      await onSave(
        source.id,
        resolveEditSourcePayload({
          source,
          fieldKind,
          name,
          category,
          url: fieldKind === 'rsshub' ? rsshubFullUrl || url : url,
          updateInterval,
          subscriptionMode,
          customIcon: iconDirty ? icon : null,
          themeColor,
          styleTags,
          adminOnly,
          notionToken,
          rsshubRoute,
        }),
      )
    } catch (err) {
      setError(userFacingError(err, brew.errorSaveFailed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={`brew-add-form${categoryOpen ? ' is-category-open' : ''}`}
    >
      <form
        className="brew-add-form__stack"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
      >
        {fieldKind === 'note' ? (
          <div className="brew-add-form__tags">
            <SettingTitleTag>{brew.boardNotes}</SettingTitleTag>
          </div>
        ) : (
          <SourceKindControl
            value={fieldKind}
            onChange={pickKind}
            disabled={saving}
          />
        )}

        {showMode ? (
          <>
            <SwitchItem
              itemKey="brew-edit-brewlia"
              size="sm"
              label="Brewlia AI"
              description={
                fieldKind === 'rsshub'
                  ? brew.brewliaFeatures
                  : brew.brewliaShortDesc
              }
              value={brewliaOn}
              onChange={setBrewliaOn}
              disabled={saving}
            />
            <SwitchItem
              itemKey="brew-edit-paused"
              size="sm"
              label={brew.pauseFetch}
              value={paused}
              onChange={setPaused}
              disabled={saving}
            />
          </>
        ) : null}

        {fieldKind === 'rsshub' ? (
          <RSSHubConfigComponent
            initialConfig={
              source.rsshub_route
                ? { instanceUrl: '', routePath: source.rsshub_route }
                : undefined
            }
            onConfigChange={(config: RSSHubConfig, fullUrl: string) => {
              setRsshubFullUrl(fullUrl)
              setRsshubRoute(config.routePath)
            }}
            isEditMode
            disabled={saving}
          />
        ) : null}

        {fieldKind !== 'note' && fieldKind !== 'rsshub' ? (
          <InputItem
            itemKey="brew-edit-url"
            size="sm"
            label={brew[addUrlLabelKey(fieldKind)]}
            required
            inputType="url"
            value={url}
            onChange={setUrl}
            placeholder={addUrlPlaceholder(fieldKind)}
            disabled={saving}
            labelAccessory={
              fieldKind === 'rss' ? (
                <SettingTitleTag
                  icon={discovering ? <Spinner size="xs" /> : <Search />}
                  disabled={discovering || !url.trim() || !onDiscover}
                  onClick={() => {
                    void handleDiscover()
                  }}
                >
                  {brew.discover}
                </SettingTitleTag>
              ) : null
            }
          />
        ) : null}

        {fieldKind === 'notion' ? (
          <InputItem
            itemKey="brew-edit-notion-token"
            size="sm"
            label="Notion Integration Token"
            required={originalKind !== 'notion'}
            inputType="password"
            value={notionToken}
            onChange={setNotionToken}
            placeholder="secret_xxx..."
            disabled={saving}
          />
        ) : null}

        <CompactSettingGroup>
          <InputItem
            itemKey="brew-edit-name"
            size="sm"
            label={brew.nameLabel}
            required={isLink}
            value={name}
            onChange={setName}
            placeholder={isLink ? brew.enterName : brew.sourceName}
            disabled={saving}
          />
          <SourceCategoryField
            categories={allCategories}
            value={category}
            open={categoryOpen}
            onOpenChange={setCategoryOpen}
            onChange={setCategory}
            disabled={saving}
            labelFor={(name) => categoryLabel(name, presetLabels)}
          />
        </CompactSettingGroup>

        <InputItem
          itemKey="brew-edit-color"
          size="sm"
          label={brew.themeColor}
          value={themeColor}
          onChange={setThemeColor}
          placeholder="#f97316"
          disabled={saving}
          labelAccessory={
            <input
              type="color"
              className="brew-add-form__swatch"
              value={themeColor || '#f97316'}
              onChange={(event) => setThemeColor(event.target.value)}
              disabled={saving}
              title={brew.themeColor}
            />
          }
        />

        {showInterval ? (
          <SelectItem
            itemKey="brew-edit-interval"
            size="sm"
            label={brew.updateInterval}
            value={String(updateInterval)}
            onChange={(next) => setUpdateInterval(Number(next))}
            disabled={saving}
            options={(EDIT_INTERVALS.includes(
              updateInterval as (typeof EDIT_INTERVALS)[number],
            )
              ? EDIT_INTERVALS
              : [...EDIT_INTERVALS, updateInterval].toSorted((a, b) => a - b)
            ).map((value) => ({
              value: String(value),
              label: intervalLabels[value] ?? `${value}`,
            }))}
          />
        ) : null}

        <InputItem
          itemKey="brew-edit-icon"
          size="sm"
          variant="imageUpload"
          label={brew.siteIcon}
          value={icon}
          onChange={changeIcon}
          uploadLabel={brew.upload}
          clearImageLabel={brew.deleteIcon}
          disabled={saving}
        />

        {showAiTags ? (
          <TagEditor
            itemKey="brew-edit-ai-tag"
            label={brew.aiStyleTags}
            description={brew.styleTagsDesc}
            draft={newTag}
            onDraft={setNewTag}
            placeholder={brew.tagInputPlaceholder}
            tags={styleTags}
            empty={brew.noTagsHint}
            deleteLabel={brew.deleteTag}
            disabled={saving || generatingTags || styleTags.length >= 3}
            onAdd={addTag}
            onRemove={(tag) =>
              setStyleTags((prev) => prev.filter((item) => item !== tag))
            }
            accessory={
              <SettingTitleTag
                icon={generatingTags ? <Spinner size="xs" /> : <Sparkles />}
                disabled={generatingTags || !onGenerateStyleTags || saving}
                onClick={() => {
                  if (!onGenerateStyleTags) return
                  const signal = generateTurns.current.begin()
                  setGeneratingTags(true)
                  setError(null)
                  void onGenerateStyleTags(source.id, signal)
                    .then((result) => {
                      unlessAborted(signal, () => {
                        if (result.success && result.tags) {
                          setStyleTags(result.tags)
                        }
                      })
                    })
                    .catch((err: unknown) => {
                      unlessAborted(signal, () => {
                        setError(
                          userFacingError(err, brew.errorGenerateStyleTags),
                        )
                      })
                    })
                    .finally(() => {
                      unlessAborted(signal, () => setGeneratingTags(false))
                    })
                }}
              >
                {styleTags.length > 0 ? brew.regenerateTags : brew.generateTags}
              </SettingTitleTag>
            }
          />
        ) : null}

        {showCustomTags ? (
          <TagEditor
            itemKey="brew-edit-custom-tag"
            label={brew.customTag}
            description={brew.customTagDesc}
            draft={newTag}
            onDraft={setNewTag}
            placeholder={brew.tagInputPlaceholder}
            tags={styleTags}
            empty={brew.noCustomTagHint}
            deleteLabel={brew.deleteTag}
            disabled={saving || styleTags.length >= 3}
            onAdd={addTag}
            onRemove={(tag) =>
              setStyleTags((prev) => prev.filter((item) => item !== tag))
            }
            accessory={
              <SettingTitleTag
                disabled={!newTag.trim() || styleTags.length >= 3 || saving}
                onClick={addTag}
              >
                {brew.addTag}
              </SettingTitleTag>
            }
          />
        ) : null}

        <SwitchItem
          itemKey="brew-edit-admin"
          size="sm"
          label={brew.adminOnlyVisible}
          description={brew.adminOnlyVisibleHint}
          value={adminOnly}
          onChange={setAdminOnly}
          disabled={saving}
        />

        {error ? (
          <SettingTitleTag variant="danger">{error}</SettingTitleTag>
        ) : null}

        <SettingsButton
          type="submit"
          variant="primary"
          size="sm"
          block
          loading={saving}
          disabled={saving || !canSubmit}
        >
          {brew.saveChanges}
        </SettingsButton>
      </form>
    </div>
  )
}
