import type { RSSHubQueryParams } from '../../../types/brew'
import type { ManagedListItem } from '../../settings/ManagedList'
import {
  LuChevronDown as ChevronDown,
  LuExternalLink as ExternalLink,
  LuPlus as Plus,
  LuTrash2 as Trash2,
} from '@lib/icons'
import { useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { InputItem } from '../../settings/items/InputItem'
import { SelectItem } from '../../settings/items/SelectItem'
import { SettingsButton } from '../../settings/items/SettingsButton'
import { ManagedList } from '../../settings/ManagedList'
import { SettingTitleTag } from '../../settings/SettingTitleTag'
import './RSSHubAdvanced.css'

const COMMON_PARAMS = [
  {
    key: 'limit',
    labelKey: 'rsshubParamLimit' as const,
    placeholder: '10',
    kind: 'number' as const,
    descKey: 'rsshubParamLimitDesc' as const,
  },
  {
    key: 'mode',
    labelKey: 'rsshubParamMode' as const,
    kind: 'select' as const,
    options: [
      { value: '', labelKey: 'rsshubDefault' as const },
      { value: 'fulltext', labelKey: 'rsshubFulltext' as const },
    ],
    descKey: 'rsshubParamModeDesc' as const,
  },
  {
    key: 'filter',
    labelKey: 'rsshubParamFilter' as const,
    placeholder: '',
    kind: 'text' as const,
    descKey: 'rsshubParamFilterDesc' as const,
  },
  {
    key: 'filter_title',
    labelKey: 'rsshubParamFilterTitle' as const,
    placeholder: '',
    kind: 'text' as const,
    descKey: 'rsshubParamFilterTitleDesc' as const,
  },
  {
    key: 'filterout',
    labelKey: 'rsshubParamFilterout' as const,
    placeholder: '',
    kind: 'text' as const,
    descKey: 'rsshubParamFilteroutDesc' as const,
  },
  {
    key: 'filterout_title',
    labelKey: 'rsshubParamFilteroutTitle' as const,
    placeholder: '',
    kind: 'text' as const,
    descKey: 'rsshubParamFilteroutTitleDesc' as const,
  },
  {
    key: 'filter_time',
    labelKey: 'rsshubParamFilterTime' as const,
    placeholder: '',
    kind: 'number' as const,
    descKey: 'rsshubParamFilterTimeDesc' as const,
  },
  {
    key: 'format',
    labelKey: 'rsshubParamFormat' as const,
    kind: 'select' as const,
    options: [
      { value: '', labelKey: 'rsshubDefaultRss' as const },
      { value: 'atom', labelKey: 'rsshubAtom' as const },
      { value: 'json', labelKey: 'rsshubJson' as const },
    ],
    descKey: 'rsshubParamFormatDesc' as const,
  },
]

const COMMON_KEYS = new Set(COMMON_PARAMS.map((param) => param.key))

function patchParam(
  prev: RSSHubQueryParams,
  key: string,
  value: string,
  kind: 'text' | 'number' | 'select',
): RSSHubQueryParams {
  if (!value) {
    const { [key]: _removed, ...rest } = prev
    return rest
  }
  return {
    ...prev,
    [key]: kind === 'number' ? Number(value) : value,
  }
}

export function RSSHubAdvanced({
  queryParams,
  disabled = false,
  onChange,
}: {
  queryParams: RSSHubQueryParams
  disabled?: boolean
  onChange: (next: RSSHubQueryParams) => void
}) {
  const { t, format } = useI18n()
  const brew = t.brew
  const configured = Object.keys(queryParams).length
  const [open, setOpen] = useState(() => configured > 0)
  const [customKey, setCustomKey] = useState('')
  const [customValue, setCustomValue] = useState('')

  const summary = Object.entries(queryParams)
    .filter(([, value]) => value !== undefined && value !== '' && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' · ')

  const customItems: ManagedListItem[] = useMemo(() => {
    return Object.entries(queryParams)
      .filter(([key]) => !COMMON_KEYS.has(key))
      .map(([key, value]) => ({
        id: key,
        title: key,
        subtitle: String(value),
        actions: [
          {
            key: 'delete',
            label: brew.delete,
            icon: <Trash2 />,
            variant: 'danger' as const,
            disabled,
            ariaLabel: format(brew.rsshubDeleteParam, { param: key }),
            onClick: () => {
              const { [key]: _removed, ...rest } = queryParams
              onChange(rest)
            },
          },
        ],
      }))
  }, [brew.delete, brew.rsshubDeleteParam, disabled, format, onChange, queryParams])

  const addCustom = () => {
    const key = customKey.trim()
    const value = customValue.trim()
    if (!key || !value || disabled) return
    onChange({ ...queryParams, [key]: value })
    setCustomKey('')
    setCustomValue('')
  }

  return (
    <div
      className={`brew-rsshub-advanced${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <button
        type="button"
        className="brew-rsshub-advanced__summary"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((next) => !next)
        }}
      >
        <span className="brew-rsshub-advanced__summary-main">
          <span className="brew-rsshub-advanced__summary-name">
            {brew.rsshubAdvancedOptions}
          </span>
          {summary ? (
            <span className="brew-rsshub-advanced__summary-url">{summary}</span>
          ) : null}
        </span>
        <span className="brew-rsshub-advanced__summary-side">
          {configured > 0 ? (
            <SettingTitleTag variant="default">
              {brew.rsshubConfigured}
            </SettingTitleTag>
          ) : null}
          <ChevronDown className="brew-rsshub-advanced__chevron" />
        </span>
      </button>

      {open ? (
        <div className="brew-rsshub-advanced__panel">
          <div className="brew-rsshub-advanced__form">
            {COMMON_PARAMS.map((param) =>
              param.kind === 'select' ? (
                <SelectItem
                  key={param.key}
                  itemKey={`rsshub-query-${param.key}`}
                  size="sm"
                  label={brew[param.labelKey]}
                  description={brew[param.descKey]}
                  value={String(queryParams[param.key] ?? '')}
                  options={param.options.map((option) => ({
                    value: option.value,
                    label: brew[option.labelKey],
                  }))}
                  disabled={disabled}
                  onChange={(value) =>
                    onChange(patchParam(queryParams, param.key, value, 'select'))
                  }
                />
              ) : (
                <InputItem
                  key={param.key}
                  itemKey={`rsshub-query-${param.key}`}
                  size="sm"
                  label={brew[param.labelKey]}
                  description={brew[param.descKey]}
                  inputType={param.kind === 'number' ? 'number' : 'text'}
                  value={
                    queryParams[param.key] == null
                      ? ''
                      : String(queryParams[param.key])
                  }
                  placeholder={param.placeholder}
                  disabled={disabled}
                  autoComplete="off"
                  onChange={(value) =>
                    onChange(patchParam(queryParams, param.key, value, param.kind))
                  }
                />
              ),
            )}
          </div>

          <SettingTitleTag variant="muted">
            {brew.rsshubCustomParams}
          </SettingTitleTag>
          {customItems.length > 0 ? (
            <ManagedList
              className="brew-rsshub-advanced__list"
              items={customItems}
              emptyText={brew.rsshubCustomParams}
              maxHeight="8rem"
            />
          ) : null}
          <div className="brew-rsshub-advanced__form">
            <InputItem
              itemKey="rsshub-custom-key"
              size="sm"
              label={brew.rsshubParamName}
              value={customKey}
              onChange={setCustomKey}
              placeholder={brew.rsshubParamName}
              disabled={disabled}
              autoComplete="off"
            />
            <InputItem
              itemKey="rsshub-custom-value"
              size="sm"
              label={brew.rsshubParamValue}
              value={customValue}
              onChange={setCustomValue}
              placeholder={brew.rsshubParamValue}
              disabled={disabled}
              autoComplete="off"
            />
            <SettingsButton
              size="sm"
              icon={<Plus />}
              disabled={disabled || !customKey.trim() || !customValue.trim()}
              onClick={addCustom}
            >
              {brew.rsshubAddCustomParam}
            </SettingsButton>
          </div>

          <p className="brew-rsshub-advanced__hint">
            {brew.rsshubSpecialRouteHint}
          </p>
          <SettingsButton
            size="sm"
            variant="ghost"
            icon={<ExternalLink />}
            onClick={() => {
              window.open(
                'https://docs.rsshub.app/guide/parameters',
                '_blank',
                'noopener,noreferrer',
              )
            }}
          >
            {brew.rsshubParamDocs}
          </SettingsButton>
        </div>
      ) : null}
    </div>
  )
}
