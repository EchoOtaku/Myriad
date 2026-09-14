import type { AddSubmitInput } from './useAddSourceForm'
import {
  LuCheck as Check,
  LuDownload as Download,
  LuFileText as FileText,
  LuFolderOpen as FolderOpen,
  LuLink as Link,
  LuSearch as Search,
  LuUpload as Upload,
} from '@lib/icons'
import { useI18n } from '../../../../contexts/I18nContext'
import { CompactSettingGroup } from '../../../settings/CompactSettingGroup'
import { SegmentedControl } from '../../../settings/items/ChoiceControls'
import { InputItem } from '../../../settings/items/InputItem'
import { SettingsButton } from '../../../settings/items/SettingsButton'
import { SwitchItem } from '../../../settings/items/SwitchItem'
import { SettingTitleTag } from '../../../settings/SettingTitleTag'
import { Spinner } from '../../../Spinner'
import {
  addSubmitLabelKey,
  addUrlLabelKey,
  addUrlPlaceholder,
} from './addSource'
import { SourceCategoryField } from './SourceCategoryField'
import { SourceKindControl } from './SourceKindControl'
import { useAddSourceForm } from './useAddSourceForm'
import './AddMode.css'

interface AddModeProps {
  tabs?: 'all' | 'single' | 'opml'
  allCategories: string[]
  sourcesCount: number
  onSubmit?: (
    data: AddSubmitInput,
  ) => Promise<{ success: boolean; error?: string; title?: string }>
  onDiscover?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{
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
  tabs = 'all',
  allCategories,
  sourcesCount,
  onSubmit,
  onDiscover,
  onImportOpml,
  onExportOpml,
  RSSHubConfigComponent,
}: AddModeProps) {
  const { t: i18n, format } = useI18n()
  const t = i18n.phantasi
  const form = useAddSourceForm({
    onSubmit,
    onDiscover,
    onImportOpml,
    onExportOpml,
  })
  const tab = tabs === 'all' ? form.tab : tabs
  const urlLabel = t[addUrlLabelKey(form.fieldKind)]
  const submitLabel = t[addSubmitLabelKey(form.sourceType)]

  return (
    <div
      className={`phantasi-add-form${form.categoryOpen ? ' is-category-open' : ''}`}
    >
      {tabs === 'all' ? (
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
      ) : null}

      {tab === 'single' ? (
        <form className="phantasi-add-form__stack" onSubmit={form.handleSubmit}>
          <SourceKindControl
            value={form.fieldKind}
            onChange={form.pickKind}
            disabled={form.loading}
          />

          {form.sourceType !== 'link' && form.sourceType !== 'rsshub' ? (
            <SwitchItem
              itemKey="phantasi-add-phantasiai"
              size="sm"
              label={t.phantasiaiLabel}
              description={t.phantasiaiShortDesc}
              value={form.sourceType === 'phantasiai'}
              onChange={(on) => form.setSourceType(on ? 'phantasiai' : 'rss')}
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
                itemKey="phantasi-add-rsshub-phantasiai"
                size="sm"
                label={t.phantasiaiLabel}
                description={t.phantasiaiFeatures}
                value={form.enablePhantasiaiForRsshub}
                onChange={form.setEnablePhantasiaiForRsshub}
                disabled={form.loading}
              />
            </>
          ) : null}

          {form.sourceType !== 'rsshub' ? (
            <InputItem
              itemKey="phantasi-add-url"
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
              itemKey="phantasi-add-notion-token"
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
            <div className="phantasi-add-form__tags">
              <SettingTitleTag icon={<Check />}>
                {form.discovered.title}
              </SettingTitleTag>
              <SettingTitleTag variant="muted">
                {form.discovered.feed_type.toUpperCase()}
              </SettingTitleTag>
              {form.sourceType === 'phantasiai' ? (
                <SettingTitleTag variant="beta">AI</SettingTitleTag>
              ) : null}
            </div>
          ) : null}

          <CompactSettingGroup>
            <InputItem
              itemKey="phantasi-add-name"
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
            <SourceCategoryField
              categories={allCategories}
              value={form.category}
              open={form.categoryOpen}
              onOpenChange={form.setCategoryOpen}
              onChange={form.setCategory}
              disabled={form.loading}
            />
          </CompactSettingGroup>

          <InputItem
            itemKey="phantasi-add-icon"
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
        <div className="phantasi-add-form__stack">
          <button
            type="button"
            className={`phantasi-add-form__drop${form.dragOver ? ' is-on' : ''}`}
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
              className="phantasi-add-form__file"
              title={t.selectOpmlFile}
            />
            <FolderOpen />
            <p>{t.dropOpmlHere}</p>
            <small>{t.supportedFormats}</small>
          </button>

          <div className="phantasi-add-form__actions">
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
