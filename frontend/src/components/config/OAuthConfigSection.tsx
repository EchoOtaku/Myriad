/**
 * OAuth 配置区块（重构版）
 *
 * 设计：
 * - 顶部：回调 URL 显示器（动态根据 slug）+ 注册开关
 * - 中部：已配置的 providers 卡片列表（GitHub 也是其中一种，kind="github"）
 * - 底部：「+ 添加登录方式」→ preset 选择器 → 自动填 discovery/scopes/icon，
 *   用户只补 client_id/secret
 *
 * 详见 docs/oauth-refactor-plan.md + oauthPresets.ts
 */

import {
  FaCheck,
  FaClipboard,
  FaExternalLinkAlt,
  FaGithub,
  FaPlus,
  FaTrash,
} from '@lib/icons'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { API_URL } from '../../config'

import { useI18n } from '../../contexts/I18nContext'
import { fetchJson } from '../../utils/apiHelper'
import { getCSRFToken } from '../../utils/csrf'
import {
  normalizeOAuthIconUrl,
  preloadOAuthIcons,
} from '../../utils/oauthIcons'
import OAuthIconImage from '../OAuthIconImage'
import { InfoCard, InputItem, SettingSection, SwitchItem } from '../settings'
import { findPreset, OAUTH_PRESETS } from './oauthPresets'

/** 把字符串中反引号 `foo` 包裹的片段渲染为 <code>foo</code> */
function renderHint(text: string): React.ReactNode {
  const parts = text.split(/`([^`]+)`/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="inline-code">
        {part}
      </code>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  )
}

interface ConfigField {
  key: string
  value: string
}

interface OAuthConfigSectionProps {
  configFields: ConfigField[]
  updateValue: (key: string, value: string) => void
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
}

/** 与后端 config::OAuthProviderEntry 对齐 */
interface OAuthProviderEntry {
  slug: string
  kind: 'github' | 'oidc'
  display_name: string
  enabled: boolean
  client_id: string
  client_secret: string
  scopes: string[]
  discovery_url?: string | null
  icon_url?: string | null
}

function normalizeProviderEntry(
  provider: OAuthProviderEntry,
): OAuthProviderEntry {
  return {
    ...provider,
    icon_url: normalizeOAuthIconUrl(provider.icon_url),
  }
}

function openPresetPicker(
  setPicker: React.Dispatch<React.SetStateAction<boolean>>,
  iconUrls: Array<string | null | undefined>,
) {
  preloadOAuthIcons(iconUrls)
  setPicker(true)
}

export const OAuthConfigSection: React.FC<OAuthConfigSectionProps> = ({
  configFields,
  updateValue: _updateValue,
  title,
  icon,
  description,
  sectionId,
}) => {
  const { t } = useI18n()

  const getFieldValue = useCallback(
    (key: string) => {
      return configFields.find((f) => f.key === key)?.value || ''
    },
    [configFields],
  )

  const baseUrl = getFieldValue('base_url').replace(/\/$/, '')

  // ---- providers + 开关 ----
  const [providers, setProviders] = useState<OAuthProviderEntry[]>([])
  const [allowRegister, setAllowRegister] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 选 preset 的弹层状态
  const [picker, setPicker] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const data = await fetchJson(`${API_URL}/api/config/oauth-providers`, {
          credentials: 'include',
        })
        if (cancelled) return
        const normalizedProviders = Array.isArray(data?.providers)
          ? data.providers.map(normalizeProviderEntry)
          : []
        preloadOAuthIcons(normalizedProviders.map((provider) => provider.icon_url))
        setProviders(normalizedProviders)
        setAllowRegister(Boolean(data?.allow_local_registration))
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const updateProvider = (idx: number, patch: Partial<OAuthProviderEntry>) => {
    setProviders((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    )
  }
  const removeProvider = (idx: number) => {
    setProviders((prev) => prev.filter((_, i) => i !== idx))
  }

  const addFromPreset = (presetId: string) => {
    const preset = findPreset(presetId)
    if (!preset) return
    // 生成唯一 slug
    let slug = preset.defaultSlug || preset.id
    if (slug && providers.some((p) => p.slug === slug)) {
      let n = 2
      while (providers.some((p) => p.slug === `${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }
    const entry: OAuthProviderEntry = {
      slug,
      kind: preset.kind,
      display_name: preset.display_name,
      enabled: true,
      client_id: '',
      client_secret: '',
      scopes: [...preset.scopes],
      discovery_url: preset.discovery_url || '',
      icon_url: preset.icon_url || null,
    }
    setProviders((prev) => [...prev, entry])
    setPicker(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload = {
        providers: providers.map((p) => ({
          ...p,
          discovery_url: p.discovery_url || null,
          icon_url: normalizeOAuthIconUrl(p.icon_url),
          scopes: p.scopes.filter(Boolean),
        })),
        allow_local_registration: allowRegister,
      }
      // 加 CSRF token — admin 端点经过 csrf_middleware
      const csrfToken = await getCSRFToken()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken

      await fetchJson(`${API_URL}/api/config/oauth-providers`, {
        method: 'PUT',
        credentials: 'include',
        headers,
        body: JSON.stringify(payload),
      })
      // 保存成功后重新拉一次，让后端做的规范化（slug 大小写、secret 掩码等）反映到 UI
      const refreshed = await fetchJson(
        `${API_URL}/api/config/oauth-providers`,
        {
          credentials: 'include',
        },
      )
      if (Array.isArray(refreshed?.providers)) {
        const normalizedProviders = refreshed.providers.map(normalizeProviderEntry)
        preloadOAuthIcons(normalizedProviders.map((provider) => provider.icon_url))
        setProviders(normalizedProviders)
        setAllowRegister(Boolean(refreshed?.allow_local_registration))
      }
      setSaved(true)
      setTimeout(setSaved, 2500, false)
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // 可用 preset = 全部 - 已用 GitHub 的（一个实例足够）
  const availablePresets = useMemo(() => {
    const hasGithub = providers.some(
      (p) => p.slug === 'github' && p.kind === 'github',
    )
    return OAUTH_PRESETS.filter((p) => !(p.id === 'github' && hasGithub))
  }, [providers])

  const handleOpenPicker = useCallback(() => {
    openPresetPicker(
      setPicker,
      availablePresets.map((preset) => preset.icon_url),
    )
  }, [availablePresets])

  const handleTogglePicker = useCallback(() => {
    if (picker) {
      setPicker(false)
      return
    }
    handleOpenPicker()
  }, [handleOpenPicker, picker])

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
    >
      {!baseUrl && (
        <InfoCard
          title={t.config.oauthGuideTitle}
          content={
            <>
              <strong>{t.config.callbackUrlNotConfigured}</strong>
              <br />
              {t.config.oauthHowToHint}
            </>
          }
          className="info-card-spaced"
        />
      )}

      {/* 本地注册开关 */}
      <SwitchItem
        itemKey="allow_local_registration"
        label={t.config.allowRegisterTitle}
        description={t.config.allowRegisterDesc}
        value={allowRegister}
        onChange={setAllowRegister}
      />

      {/* providers 列表 */}
      <div className="oidc-section">
        <div className="oidc-section-head">
          <div className="oidc-section-head-text">
            <h3 className="oidc-section-title">
              {t.config.oauthProvidersTitle}
            </h3>
            <p className="oidc-section-desc">{t.config.oauthProvidersDesc}</p>
          </div>
          <button
            type="button"
            className="btn-base btn-secondary btn-sm"
            onClick={handleTogglePicker}
          >
            <FaPlus />
            {t.config.oauthAddLoginMethod}
          </button>
        </div>

        {picker && (
          <PresetPicker
            presets={availablePresets}
            onPick={addFromPreset}
            onClose={() => setPicker(false)}
            t={t}
          />
        )}

        {loading && <p className="oidc-loading">…</p>}

        {!loading && providers.length === 0 && !picker && (
          <button
            type="button"
            className="oidc-empty oidc-empty-clickable"
            onClick={handleOpenPicker}
          >
            <FaPlus />
            <span>{t.config.oauthProvidersEmpty}</span>
          </button>
        )}

        {providers.map((p, idx) => (
          <ProviderCard
            key={`${p.slug}-${idx}`}
            entry={p}
            baseUrl={baseUrl}
            onChange={(patch) => updateProvider(idx, patch)}
            onRemove={() => removeProvider(idx)}
            t={t}
          />
        ))}

        {(providers.length > 0 || error || saved) && (
          <div className="oidc-save-bar">
            <div className="oidc-save-bar-status">
              {saved && (
                <span className="oidc-status success">
                  <FaCheck />
                  {t.config.oidcSaved}
                </span>
              )}
              {error && <span className="oidc-status error">{error}</span>}
            </div>
            <button
              type="button"
              className="btn-base btn-primary"
              onClick={save}
              disabled={saving}
            >
              <FaCheck />
              {saving ? t.config.oidcSaving : t.config.oidcSaveConfig}
            </button>
          </div>
        )}
      </div>
    </SettingSection>
  )
}

export default OAuthConfigSection

// ============================================================================
// Subcomponents
// ============================================================================

interface ProviderCardProps {
  entry: OAuthProviderEntry
  baseUrl: string
  onChange: (patch: Partial<OAuthProviderEntry>) => void
  onRemove: () => void
  t: any
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  entry,
  baseUrl,
  onChange,
  onRemove,
  t,
}) => {
  const [copied, setCopied] = useState(false)
  const callbackUrl =
    baseUrl && entry.slug
      ? `${baseUrl}/api/auth/oauth/${entry.slug}/callback`
      : null

  const copy = async () => {
    if (!callbackUrl) return
    await navigator.clipboard.writeText(callbackUrl)
    setCopied(true)
    setTimeout(setCopied, 2000, false)
  }

  // preset 提示（按 slug 匹配 — 比如 slug='github-2' 也算 github 类型）
  const preset = OAUTH_PRESETS.find(
    (p) =>
      p.kind === entry.kind && entry.slug.startsWith(p.defaultSlug || p.id),
  )

  return (
    <div className={`oidc-provider-card${entry.enabled ? '' : ' disabled'}`}>
      <div className="oidc-provider-header">
        <span className="oidc-provider-title">
          <ProviderIcon entry={entry} />
          <span className="oidc-provider-title-text">
            {entry.display_name || entry.slug || t.config.oidcNewProvider}
          </span>
        </span>
        <div className="oidc-provider-actions">
          <label className="oidc-enable-toggle">
            <span className="oidc-enable-toggle-label">
              {t.config.oidcEnabled}
            </span>
            <span className="toggle-switch">
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(e) => onChange({ enabled: e.target.checked })}
              />
              <span className="toggle-slider"></span>
            </span>
          </label>
          <button
            type="button"
            className="btn-base btn-danger btn-sm"
            onClick={onRemove}
            aria-label={t.config.oidcDelete}
          >
            <FaTrash />
          </button>
        </div>
      </div>

      {/* 回调 URL — 用户复制粘到 provider 后台 */}
      {callbackUrl && (
        <div className="oidc-callback-row">
          <span className="oidc-callback-label">
            {t.config.currentCallbackUrl}
          </span>
          <code className="inline-code callback-url-code">{callbackUrl}</code>
          <button
            type="button"
            className="copy-btn"
            onClick={copy}
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? <FaCheck /> : <FaClipboard />}
          </button>
        </div>
      )}

      {/* preset 提示 — i18n 翻译 + 反引号片段渲染为 <code> */}
      {preset?.hintKey && (
        <InfoCard
          content={
            <>
              {renderHint(
                (t.config as Record<string, string>)[preset.hintKey] ?? '',
              )}
              {preset.docs_url && (
                <>
                  {' '}
                  <a
                    href={preset.docs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="oidc-docs-link"
                  >
                    {t.config.oauthOpenDocs}
                    <FaExternalLinkAlt />
                  </a>
                </>
              )}
            </>
          }
          className="info-card-spaced"
        />
      )}

      <div className="oidc-provider-fields">
        {/* 必填：client_id / client_secret */}
        <InputItem
          itemKey={`provider-${entry.slug}-client-id`}
          label={t.config.oidcClientIdLabel}
          required
          value={entry.client_id}
          onChange={(v) => onChange({ client_id: v })}
          placeholder=""
          layout="vertical"
        />
        <InputItem
          itemKey={`provider-${entry.slug}-client-secret`}
          label={t.config.oidcClientSecretLabel}
          required
          value={entry.client_secret}
          onChange={(v) => onChange({ client_secret: v })}
          placeholder={t.config.oidcClientSecretPlaceholder}
          inputType="password"
          autoSelectOnMask
          layout="vertical"
        />

        {/* OIDC 额外字段：discovery_url（必填） */}
        {entry.kind === 'oidc' && (
          <div className="full-width">
            <InputItem
              itemKey={`provider-${entry.slug}-discovery`}
              label={t.config.oidcDiscoveryLabel}
              required
              value={entry.discovery_url || ''}
              onChange={(v) => onChange({ discovery_url: v })}
              placeholder={t.config.oidcDiscoveryPlaceholder}
              layout="vertical"
            />
          </div>
        )}

        {/* 高级（折叠） */}
        <AdvancedFields entry={entry} onChange={onChange} t={t} />
      </div>
    </div>
  )
}

const ProviderIcon: React.FC<{ entry: OAuthProviderEntry }> = ({ entry }) => {
  const iconSrc = normalizeOAuthIconUrl(entry.icon_url)
  if (entry.kind === 'github' || entry.slug === 'github') {
    return <FaGithub className="oidc-provider-icon-img" />
  }
  if (iconSrc) {
    return (
      <OAuthIconImage
        src={iconSrc}
        size={20}
        className="oidc-provider-icon-img"
        fetchPriority="low"
      />
    )
  }
  return (
    <span className="oidc-provider-icon-img oidc-provider-icon-placeholder">
      {(entry.display_name || entry.slug || '?')[0]?.toUpperCase()}
    </span>
  )
}

interface AdvancedFieldsProps {
  entry: OAuthProviderEntry
  onChange: (patch: Partial<OAuthProviderEntry>) => void
  t: any
}

const AdvancedFields: React.FC<AdvancedFieldsProps> = ({
  entry,
  onChange,
  t,
}) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="full-width oidc-advanced">
      <button
        type="button"
        className="oidc-advanced-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▼' : '▶'} {t.config.oauthAdvanced}
      </button>
      {open && (
        <div className="oidc-advanced-content">
          <InputItem
            itemKey={`provider-${entry.slug}-slug`}
            label={t.config.oidcSlugLabel}
            value={entry.slug}
            onChange={(v) => onChange({ slug: v })}
            placeholder={t.config.oidcSlugPlaceholder}
            layout="vertical"
          />
          <InputItem
            itemKey={`provider-${entry.slug}-display`}
            label={t.config.oidcDisplayNameLabel}
            value={entry.display_name}
            onChange={(v) => onChange({ display_name: v })}
            placeholder={t.config.oidcDisplayNamePlaceholder}
            layout="vertical"
          />
          {entry.kind === 'oidc' && (
            <InputItem
              itemKey={`provider-${entry.slug}-scopes`}
              label={t.config.oidcScopesLabel}
              value={entry.scopes.join(' ')}
              onChange={(v) =>
                onChange({ scopes: v.split(/\s+/).filter(Boolean) })
              }
              placeholder={t.config.oidcScopesPlaceholder}
              layout="vertical"
            />
          )}
          <InputItem
            itemKey={`provider-${entry.slug}-icon`}
            label={t.config.oidcIconLabel}
            value={entry.icon_url || ''}
            onChange={(v) => onChange({ icon_url: v })}
            placeholder={t.config.oidcIconPlaceholder}
            layout="vertical"
          />
        </div>
      )}
    </div>
  )
}

interface PresetPickerProps {
  presets: typeof OAUTH_PRESETS
  onPick: (id: string) => void
  onClose: () => void
  t: any
}

const PresetPicker: React.FC<PresetPickerProps> = ({
  presets,
  onPick,
  onClose,
  t,
}) => {
  return (
    <div className="oidc-preset-picker">
      <div className="oidc-preset-picker-header">
        <span>{t.config.oauthPickPreset}</span>
        <button
          type="button"
          className="oidc-preset-picker-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="oidc-preset-grid">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="oidc-preset-card"
            onClick={() => onPick(p.id)}
          >
            {p.id === 'github' ? (
              <FaGithub className="oidc-preset-icon" />
            ) : p.icon_url ? (
              <OAuthIconImage
                src={normalizeOAuthIconUrl(p.icon_url) ?? p.icon_url}
                size={32}
                className="oidc-preset-icon"
                fetchPriority="low"
              />
            ) : (
              <span className="oidc-preset-icon oidc-preset-icon-placeholder">
                {p.display_name[0]}
              </span>
            )}
            <span className="oidc-preset-name">{p.display_name}</span>
            {p.kind === 'oidc' && (
              <span className="oidc-preset-badge">OIDC</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
