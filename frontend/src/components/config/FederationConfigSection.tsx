/**
 * 联邦信任策略管理（管理员）
 * - allowlist / min_trust / auto_discover
 * - 实例列表：信任层级 + 封禁
 * - 内容过滤规则 CRUD
 */

import type {
  ContentFilterItem,
  FederationInstance,
} from '../../types/federation'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { federationApi } from '../../services/federationApi'
import {
  ButtonItem,
  InputItem,
  SettingGroup,
  SettingSection,
  SwitchItem,
} from '../settings'

interface FederationConfigSectionProps {
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
  onMessage?: (
    msg: string,
    type?: 'success' | 'error' | 'warning' | 'info',
  ) => void
}

const FILTER_TYPES = [
  'block_activity_type',
  'block_keyword',
  'require_trust_level',
] as const

export const FederationConfigSection: React.FC<
  FederationConfigSectionProps
> = ({ title, icon, description, sectionId, onMessage }) => {
  const { t } = useI18n()
  const c = t.config
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [instances, setInstances] = useState<FederationInstance[]>([])
  const [filters, setFilters] = useState<ContentFilterItem[]>([])

  // Policy draft
  const [minTrust, setMinTrust] = useState(0)
  const [allowlistText, setAllowlistText] = useState('')
  const [autoDiscover, setAutoDiscover] = useState(true)
  // Advanced rate limit (defaults match backend RateLimitPolicy)
  const [rateMax, setRateMax] = useState(100)
  const [rateWindow, setRateWindow] = useState(60)
  const [rateTrustedMul, setRateTrustedMul] = useState(5)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // New filter draft
  const [newFilterName, setNewFilterName] = useState('')
  const [newFilterType, setNewFilterType] =
    useState<(typeof FILTER_TYPES)[number]>('block_keyword')
  const [newFilterValue, setNewFilterValue] = useState('')

  const trustLevels = useMemo(
    () => [
      { value: 0, label: c.federationTrustUnknown },
      { value: 1, label: c.federationTrustDiscovered },
      { value: 2, label: c.federationTrustFollowed },
      { value: 3, label: c.federationTrustTrusted },
      { value: 4, label: c.federationTrustFederated },
    ],
    [c],
  )

  const filterTypeLabels: Record<(typeof FILTER_TYPES)[number], string> =
    useMemo(
      () => ({
        block_activity_type: c.federationFilterTypeBlockActivity,
        block_keyword: c.federationFilterTypeBlockKeyword,
        require_trust_level: c.federationFilterTypeRequireTrust,
      }),
      [c],
    )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, inst, f] = await Promise.all([
        federationApi.getTrustPolicy(),
        federationApi.getInstances().catch(() => ({ instances: [], total: 0 })),
        federationApi
          .listContentFilters()
          .catch(() => ({ filters: [], total: 0 })),
      ])
      setMinTrust(p.min_trust_level ?? 0)
      setAllowlistText((p.allowed_domains || []).join('\n'))
      setAutoDiscover(p.auto_discover !== false)
      setRateMax(p.rate_limit?.max_requests_per_window ?? 100)
      setRateWindow(p.rate_limit?.window_seconds ?? 60)
      setRateTrustedMul(p.rate_limit?.trusted_multiplier ?? 5)
      setInstances(inst.instances || [])
      setFilters(f.filters || [])
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : c.federationLoadFailed,
        'error',
      )
    } finally {
      setLoading(false)
    }
  }, [onMessage, c.federationLoadFailed])

  useEffect(() => {
    void load()
  }, [load])

  const savePolicy = async () => {
    setSaving(true)
    try {
      const domains = allowlistText
        .split(/[\n,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      await federationApi.updateTrustPolicy({
        min_trust_level: minTrust,
        allowed_domains: domains,
        auto_discover: autoDiscover,
        rate_limit: {
          max_requests_per_window: rateMax,
          window_seconds: rateWindow,
          trusted_multiplier: rateTrustedMul,
        },
      })
      onMessage?.(c.federationPolicySaved, 'success')
      await load()
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : c.federationSaveFailed,
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  const resetRateDefaults = () => {
    setRateMax(100)
    setRateWindow(60)
    setRateTrustedMul(5)
  }

  const setInstanceTrust = async (domain: string, level: number) => {
    try {
      await federationApi.updateInstanceTrust({ domain, trust_level: level })
      setInstances((prev) =>
        prev.map((i) =>
          i.domain === domain ? { ...i, trust_level: level } : i,
        ),
      )
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : c.federationUpdateFailed,
        'error',
      )
    }
  }

  const toggleBlock = async (domain: string, block: boolean) => {
    try {
      await federationApi.toggleInstanceBlock({ domain, block })
      setInstances((prev) =>
        prev.map((i) =>
          i.domain === domain ? { ...i, blocked: block } : i,
        ),
      )
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : c.federationBlockFailed,
        'error',
      )
    }
  }

  const addFilter = async () => {
    if (!newFilterName.trim() || !newFilterValue.trim()) {
      onMessage?.(c.federationFilterNameValueRequired, 'warning')
      return
    }
    try {
      await federationApi.createContentFilter({
        name: newFilterName.trim(),
        filter_type: newFilterType,
        value: newFilterValue.trim(),
        enabled: true,
      })
      setNewFilterName('')
      setNewFilterValue('')
      await load()
      onMessage?.(c.federationFilterAdded, 'success')
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : c.federationAddFilterFailed,
        'error',
      )
    }
  }

  const toggleFilter = async (f: ContentFilterItem) => {
    try {
      await federationApi.updateContentFilter(f.id, { enabled: !f.enabled })
      setFilters((prev) =>
        prev.map((x) =>
          x.id === f.id ? { ...x, enabled: !x.enabled } : x,
        ),
      )
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : c.federationUpdateFailed,
        'error',
      )
    }
  }

  const deleteFilter = async (id: number) => {
    try {
      await federationApi.deleteContentFilter(id)
      setFilters((prev) => prev.filter((x) => x.id !== id))
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : c.federationUpdateFailed,
        'error',
      )
    }
  }

  if (loading) {
    return (
      <SettingSection
        title={title}
        icon={icon}
        description={description}
        sectionId={sectionId}
      >
        <p className="text-sm text-gray-500">{t.common?.loading || '…'}</p>
      </SettingSection>
    )
  }

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
    >
      {/*
        Only surface controls the admin can change.
        Advanced rate-limit knobs are in the collapsible section below;
        no decorative on/off line for rate-limit.
      */}

      <SettingGroup title={c.federationInstancePolicy}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {c.federationTrustLevelHelp}
          </p>
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {c.federationMinTrustInbound}
            </span>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {c.federationMinTrustInboundDesc}
            </p>
            <select
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20"
              value={minTrust}
              onChange={(e) => setMinTrust(Number(e.target.value))}
            >
              {trustLevels.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {c.federationAllowlistDomains}
            </span>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {c.federationAllowlistDomainsDesc}
            </p>
            <textarea
              className="mt-1.5 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm font-mono dark:border-white/10 dark:bg-black/20"
              rows={4}
              value={allowlistText}
              onChange={(e) => setAllowlistText(e.target.value)}
              placeholder={c.federationAllowlistPlaceholder}
            />
          </label>

          <SwitchItem
            itemKey="fed-auto-discover"
            label={c.federationAutoDiscover}
            description={c.federationAutoDiscoverDesc}
            value={autoDiscover}
            onChange={setAutoDiscover}
          />

          <ButtonItem
            label={c.federationInstancePolicy}
            buttonText={
              saving ? '…' : c.federationSavePolicy || t.common?.save || 'Save'
            }
            onClick={() => void savePolicy()}
            disabled={saving}
            loading={saving}
          />
        </div>
      </SettingGroup>

      <SettingGroup title={c.federationKnownInstances}>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {c.federationKnownInstancesDesc}
        </p>
        {instances.length === 0 ? (
          <p className="text-sm text-gray-500">{c.federationNoInstances}</p>
        ) : (
          <ul className="space-y-2">
            {instances.map((inst) => (
              <li
                key={inst.domain}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-black/5 bg-black/2 px-3 py-2 text-sm dark:border-white/5 dark:bg-white/3"
              >
                <span className="min-w-0 flex-1 font-medium truncate">
                  {inst.domain}
                  {inst.blocked && (
                    <span className="ml-2 text-xs text-red-500">
                      {c.federationBlocked}
                    </span>
                  )}
                </span>
                <select
                  className="rounded border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/10"
                  value={inst.trust_level}
                  onChange={(e) =>
                    void setInstanceTrust(inst.domain, Number(e.target.value))
                  }
                >
                  {trustLevels.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={
                    `rounded-full px-2.5 py-1 text-xs ${
                    inst.blocked
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-500/10 text-red-600 dark:text-red-300'}`
                  }
                  onClick={() => void toggleBlock(inst.domain, !inst.blocked)}
                >
                  {inst.blocked ? c.federationUnblock : c.federationBlock}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingGroup>

      <SettingGroup title={c.federationContentFilters}>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {c.federationContentFiltersDesc}
        </p>
        <div className="space-y-2 mb-3">
          <InputItem
            itemKey="fed-filter-name"
            label={c.federationFilterName}
            value={newFilterName}
            onChange={setNewFilterName}
            placeholder="spam-keyword"
          />
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {c.federationFilterType}
            </span>
            <select
              className="mt-1 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20"
              value={newFilterType}
              onChange={(e) =>
                setNewFilterType(
                  e.target.value as (typeof FILTER_TYPES)[number],
                )
              }
            >
              {FILTER_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {filterTypeLabels[ft]}
                </option>
              ))}
            </select>
          </label>
          <InputItem
            itemKey="fed-filter-value"
            label={c.federationFilterValue}
            value={newFilterValue}
            onChange={setNewFilterValue}
            placeholder={c.federationFilterValuePlaceholder}
          />
          <ButtonItem
            label={c.federationContentFilters}
            buttonText={c.federationAddFilter}
            onClick={() => void addFilter()}
          />
        </div>
        {filters.length === 0 ? (
          <p className="text-sm text-gray-500">{c.federationNoFilters}</p>
        ) : (
          <ul className="space-y-1.5">
            {filters.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-black/5 px-3 py-2 text-sm dark:border-white/5"
              >
                <span className="min-w-0 flex-1 truncate">
                  <strong>{f.name}</strong>{' '}
                  <span className="text-xs text-gray-500">
                    {(filterTypeLabels as Record<string, string>)[
                      f.filter_type
                    ] || f.filter_type}
                    ={f.value}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs rounded-full px-2 py-0.5 bg-black/5 dark:bg-white/10"
                  onClick={() => void toggleFilter(f)}
                >
                  {f.enabled
                    ? c.federationFilterEnabled
                    : c.federationFilterDisabled}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-500"
                  onClick={() => void deleteFilter(f.id)}
                >
                  {t.common?.delete || 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingGroup>

      <SettingGroup title={c.federationAdvanced}>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {c.federationAdvancedDesc}
        </p>
        <button
          type="button"
          className="mb-3 text-sm font-medium text-[var(--tapp-primary,#6366f1)] hover:underline"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? '▾ ' : '▸ '}
          {c.federationRateLimit}
        </button>
        {advancedOpen && (
          <div className="space-y-3 rounded-lg border border-black/5 bg-black/[0.02] p-3 dark:border-white/5 dark:bg-white/[0.03]">
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {c.federationRateLimitDesc}
            </p>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                {c.federationRateMaxRequests}
              </span>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {c.federationRateMaxRequestsDesc}
              </p>
              <input
                type="number"
                min={1}
                max={1_000_000}
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm tabular-nums dark:border-white/10 dark:bg-black/20"
                value={rateMax}
                onChange={(e) =>
                  setRateMax(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                {c.federationRateWindowSeconds}
              </span>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {c.federationRateWindowSecondsDesc}
              </p>
              <input
                type="number"
                min={1}
                max={86_400}
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm tabular-nums dark:border-white/10 dark:bg-black/20"
                value={rateWindow}
                onChange={(e) =>
                  setRateWindow(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                {c.federationRateTrustedMultiplier}
              </span>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {c.federationRateTrustedMultiplierDesc}
              </p>
              <input
                type="number"
                min={1}
                max={100}
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm tabular-nums dark:border-white/10 dark:bg-black/20"
                value={rateTrustedMul}
                onChange={(e) =>
                  setRateTrustedMul(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-black/5 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
                onClick={resetRateDefaults}
              >
                {c.federationRateResetDefaults}
              </button>
              <ButtonItem
                label={c.federationRateLimit}
                buttonText={
                  saving
                    ? '…'
                    : c.federationSavePolicy || t.common?.save || 'Save'
                }
                onClick={() => void savePolicy()}
                disabled={saving}
                loading={saving}
              />
            </div>
          </div>
        )}
      </SettingGroup>
    </SettingSection>
  )
}

export default FederationConfigSection
