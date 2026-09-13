import type { AddFieldKind } from './addSource'
import type { AddSubmitInput } from './useAddSourceForm'
import {
  LuCheck as Check,
  LuDownload as Download,
  LuExternalLink as ExternalLink,
  LuFileText as FileText,
  LuFolderOpen as FolderOpen,
  LuLink as Link,
  NotionIcon,
  LuPlus as Plus,
  LuRss as Rss,
  RSSHubIcon,
  LuSearch as Search,
  LuUpload as Upload,
} from '@lib/icons'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../../contexts/I18nContext'
import { CompactSettingGroup } from '../../../settings/CompactSettingGroup'
import { SegmentedControl } from '../../../settings/items/ChoiceControls'
import { InputItem } from '../../../settings/items/InputItem'
import { SettingsButton } from '../../../settings/items/SettingsButton'
import { SwitchItem } from '../../../settings/items/SwitchItem'
import { SettingTitleTag } from '../../../settings/SettingTitleTag'
import { Spinner } from '../../../Spinner'
import {
  addHintKey,
  addSubmitLabelKey,
  addUrlLabelKey,
  addUrlPlaceholder,
} from './addSource'
import { useAddSourceForm } from './useAddSourceForm'
import './AddMode.css'

interface AddModeProps {
  allCategories: string[]
  sourcesCount: number
  onSubmit?: (
    data: AddSubmitInput,
  ) => Promise<{ success: boolean; error?: string; title?: string }>
  onDiscover?: (url: string) => Promise<{
    url: string
    autocompleted: boolean
    title: string
    feed_type: string
  } | null>
  onImportOpml?: (
    content: string,
    signal?: AbortSignal,
  ) => Promise<{ imported: number; skipped: number }>
  onExportOpml?: () => void
  RSSHubConfigComponent?: React.ComponentType<{
    onConfigChange: (config: unknown, fullUrl: string) => void
    disabled?: boolean
  }>
}

export function AddMode({
  allCategories,
  sourcesCount,
  onSubmit,
  onDiscover,
  onImportOpml,
  onExportOpml,
  RSSHubConfigComponent,
}: AddModeProps) {
  const { t: i18n, format } = useI18n()
  const t = i18n.brew
  const form = useAddSourceForm({
    onSubmit,
    onDiscover,
    onImportOpml,
    onExportOpml,
  })
  const hint = t[addHintKey(form.fieldKind)]
  const urlLabel = t[addUrlLabelKey(form.fieldKind)]
  const submitLabel = t[addSubmitLabelKey(form.sourceType)]
  const categoryWrapRef = useRef<HTMLDivElement>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)
  const [categoryDraft, setCategoryDraft] = useState('')
  const categoryName = categoryDraft.trim()
  const canAddCategory =
    categoryName.length > 0 &&
    !allCategories.includes(categoryName)

  const closeCategory = (next = categoryDraft) => {
    const value = next.trim()
    if (value !== form.category) form.setCategory(value)
    form.setCategoryOpen(false)
  }

  useEffect(() => {
    if (!form.categoryOpen) return
    setCategoryDraft(form.category)
    const id = window.setTimeout(() => categoryInputRef.current?.focus(), 0)
    const onDoc = (event: MouseEvent) => {
      if (!categoryWrapRef.current?.contains(event.target as Node)) {
        closeCategory(categoryInputRef.current?.value ?? categoryDraft)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') form.setCategoryOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [form.categoryOpen, form.category, form.setCategoryOpen])

  return (
    <div
      className={`brew-add-form${form.categoryOpen ? ' is-category-open' : ''}`}
    >
      <SegmentedControl
        size="sm"
        columns={2}
        ariaLabel={t.singleAdd}
        value={form.tab}
        onChange={form.setTab}
        options={[
          { value: 'single', label: t.singleAdd, icon: <Link /> },
          { value: 'opml', label: 'OPML', icon: <FileText /> },
        ]}
      />

      {form.tab === 'single' ? (
        <form className="brew-add-form__stack" onSubmit={form.handleSubmit}>
          <div className="setting-item setting-item-select setting-vertical setting-sm brew-add-form__type">
            <div className="setting-label">
              <span className="setting-label-text">{t.sourceTypeLabel}</span>
            </div>
            <div className="setting-control">
              <SegmentedControl<AddFieldKind>
                size="sm"
                columns={4}
                className="brew-add-form__kinds"
                ariaLabel={t.sourceTypeLabel}
                value={form.fieldKind}
                onChange={form.pickKind}
                disabled={form.loading}
                options={[
                  {
                    value: 'link',
                    label: t.pureLink,
                    icon: <ExternalLink />,
                    disabled: form.loading,
                  },
                  {
                    value: 'rss',
                    label: 'RSS',
                    icon: <Rss />,
                    disabled: form.loading,
                  },
                  {
                    value: 'rsshub',
                    label: 'RSSHub',
                    icon: <RSSHubIcon />,
                    disabled: form.loading,
                  },
                  {
                    value: 'notion',
                    label: 'Notion',
                    icon: <NotionIcon />,
                    disabled: form.loading,
                  },
                ]}
              />
            </div>
            <p className="setting-hint">{hint}</p>
          </div>

          {form.sourceType !== 'link' && form.sourceType !== 'rsshub' ? (
            <SwitchItem
              itemKey="brew-add-brewlia"
              size="sm"
              label="Brewlia AI"
              description={t.brewliaShortDesc}
              value={form.sourceType === 'brewlia'}
              onChange={(on) => form.setSourceType(on ? 'brewlia' : 'rss')}
              disabled={form.loading}
            />
          ) : null}

          {form.sourceType === 'rsshub' && RSSHubConfigComponent ? (
            <>
              <RSSHubConfigComponent
                onConfigChange={form.setRsshub}
                disabled={form.loading}
              />
              <SwitchItem
                itemKey="brew-add-rsshub-brewlia"
                size="sm"
                label="Brewlia AI"
                description={t.brewliaFeatures}
                value={form.enableBrewliaForRsshub}
                onChange={form.setEnableBrewliaForRsshub}
                disabled={form.loading}
              />
            </>
          ) : null}

          {form.sourceType !== 'rsshub' ? (
            <InputItem
              itemKey="brew-add-url"
              size="sm"
              label={urlLabel}
              required
              inputType="url"
              value={form.url}
              onChange={(value) => {
                form.setUrl(value)
                form.setDiscovered(null)
              }}
              placeholder={addUrlPlaceholder(form.fieldKind)}
              disabled={form.loading}
              labelAccessory={
                form.fieldKind === 'rss' ? (
                  <SettingTitleTag
                    icon={
                      form.discovering ? <Spinner size="xs" /> : <Search />
                    }
                    disabled={form.discovering || !form.url.trim()}
                    onClick={() => {
                      void form.handleDiscover()
                    }}
                  >
                    {t.discover}
                  </SettingTitleTag>
                ) : null
              }
            />
          ) : null}

          {form.feedType === 'notion' ? (
            <InputItem
              itemKey="brew-add-notion-token"
              size="sm"
              label="Notion Integration Token"
              required
              inputType="password"
              value={form.notionToken}
              onChange={form.setNotionToken}
              placeholder="secret_xxx..."
              disabled={form.loading}
            />
          ) : null}

          {form.discovered && form.fieldKind === 'rss' ? (
            <div className="brew-add-form__tags">
              <SettingTitleTag icon={<Check />}>
                {form.discovered.title}
              </SettingTitleTag>
              <SettingTitleTag variant="muted">
                {form.discovered.feed_type.toUpperCase()}
              </SettingTitleTag>
              {form.sourceType === 'brewlia' ? (
                <SettingTitleTag variant="beta">AI</SettingTitleTag>
              ) : null}
            </div>
          ) : null}

          <CompactSettingGroup>
            <InputItem
              itemKey="brew-add-name"
              size="sm"
              label={t.nameLabel}
              required={form.sourceType === 'link'}
              value={form.name}
              onChange={form.setName}
              placeholder={
                form.sourceType === 'link' ? t.enterName : t.autoFetch
              }
              disabled={form.loading}
            />
            <div className="setting-item setting-item-select setting-vertical setting-sm brew-add-form__category">
              <label className="setting-label">
                <span className="setting-label-text">{t.category}</span>
              </label>
              <div className="setting-control">
                <div
                  ref={categoryWrapRef}
                  className={`field-select-wrap field-select-size-sm${form.categoryOpen ? ' is-open' : ''}`}
                >
                  <button
                    type="button"
                    className="field-select field-select-trigger"
                    disabled={form.loading}
                    aria-haspopup="listbox"
                    aria-expanded={form.categoryOpen}
                    onClick={() => {
                      if (!form.loading) {
                        form.setCategoryOpen(!form.categoryOpen)
                      }
                    }}
                  >
                    <span className="field-select-value">
                      {form.category || t.selectCategory}
                    </span>
                    <span className="field-select-chevron" aria-hidden />
                  </button>
                  {form.categoryOpen ? (
                    <div className="field-select-panel">
                      <div className="field-select-search">
                        <input
                          ref={categoryInputRef}
                          type="text"
                          className="field-select-search-input"
                          value={categoryDraft}
                          onChange={(event) =>
                            setCategoryDraft(event.target.value)
                          }
                          placeholder={t.inputNewCategory}
                          autoComplete="off"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return
                            event.preventDefault()
                            event.stopPropagation()
                            if (categoryName) form.pickCategory(categoryName)
                          }}
                        />
                      </div>
                      <ul className="field-select-menu" role="listbox">
                        {canAddCategory ? (
                          <li role="presentation">
                            <button
                              type="button"
                              role="option"
                              aria-selected
                              className="field-select-option is-selected"
                              onClick={() => form.pickCategory(categoryName)}
                            >
                              <Plus />
                              {`${t.addCategory.replace(/[….]+$/u, '')}「${categoryName}」`}
                            </button>
                          </li>
                        ) : null}
                        <li role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected={!form.category && !categoryName}
                            className={`field-select-option${!form.category && !categoryName ? ' is-selected' : ''}`}
                            onClick={() => form.pickCategory('')}
                          >
                            {t.noCategory}
                          </button>
                        </li>
                        {allCategories.map((cat) => (
                          <li key={cat} role="presentation">
                            <button
                              type="button"
                              role="option"
                              aria-selected={form.category === cat}
                              className={`field-select-option${form.category === cat ? ' is-selected' : ''}`}
                              onClick={() => form.pickCategory(cat)}
                            >
                              {cat}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </CompactSettingGroup>

          <InputItem
            itemKey="brew-add-icon"
            size="sm"
            variant="imageUpload"
            label={t.siteIcon}
            value={form.customIcon || form.displayIcon || ''}
            onChange={(value) => form.setCustomIcon(value || null)}
            uploadLabel={t.upload}
            clearImageLabel={t.deleteIcon}
            disabled={form.loading}
          />

          {form.error ? (
            <SettingTitleTag variant="danger">{form.error}</SettingTitleTag>
          ) : null}
          {form.success ? (
            <SettingTitleTag icon={<Check />}>{form.success}</SettingTitleTag>
          ) : null}

          <SettingsButton
            type="submit"
            variant="primary"
            size="sm"
            block
            loading={form.loading}
            disabled={form.loading || !form.canSubmit}
          >
            {submitLabel}
          </SettingsButton>
        </form>
      ) : (
        <div className="brew-add-form__stack">
          <button
            type="button"
            className={`brew-add-form__drop${form.dragOver ? ' is-on' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              form.setDragOver(true)
            }}
            onDragLeave={() => form.setDragOver(false)}
            onDrop={form.handleDrop}
            onClick={() => form.fileInputRef.current?.click()}
          >
            <input
              ref={form.fileInputRef}
              type="file"
              accept=".opml,.xml"
              onChange={form.handleFileSelect}
              className="brew-add-form__file"
              title={t.selectOpmlFile}
            />
            <FolderOpen />
            <p>{t.dropOpmlHere}</p>
            <small>{t.supportedFormats}</small>
          </button>

          <div className="brew-add-form__actions">
            {form.opmlContent ? (
              <SettingsButton
                variant="primary"
                size="sm"
                block
                icon={<Upload />}
                loading={form.opmlLoading}
                disabled={form.opmlLoading}
                onClick={form.handleImport}
              >
                {t.startImport}
              </SettingsButton>
            ) : null}
            <SettingsButton
              size="sm"
              block
              icon={<Download />}
              loading={form.exporting}
              disabled={form.exporting || sourcesCount === 0}
              onClick={form.handleExport}
            >
              {format(t.exportOpml, { count: sourcesCount })}
            </SettingsButton>
          </div>

          {form.opmlResult ? (
            <SettingTitleTag icon={<Check />}>
              {format(t.importResult, {
                imported: form.opmlResult.imported,
                skipped:
                  form.opmlResult.skipped > 0
                    ? format(t.skippedCount, {
                        count: form.opmlResult.skipped,
                      })
                    : '',
              })}
            </SettingTitleTag>
          ) : null}
          {form.error ? (
            <SettingTitleTag variant="danger">{form.error}</SettingTitleTag>
          ) : null}
        </div>
      )}
    </div>
  )
}
