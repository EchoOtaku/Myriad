/**
 * 联邦信任策略管理（管理员）
 * - allowlist / min_trust / auto_discover
 * - 实例列表：信任层级 + 封禁
 * - 内容过滤规则 CRUD
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { federationApi } from '../../services/federationApi'
import type {
  ContentFilterItem,
  FederationInstance,
  TrustPolicyResponse,
} from '../../types/federation'
import {
  ButtonItem,
  InfoCard,
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

const TRUST_LEVELS = [
  { value: 0, label: 'Unknown (0)' },
  { value: 1, label: 'Discovered (1)' },
  { value: 2, label: 'Followed (2)' },
  { value: 3, label: 'Trusted (3)' },
  { value: 4, label: 'Federated (4)' },
]

const FILTER_TYPES = [
  'block_activity_type',
  'block_keyword',
  'require_trust_level',
] as const

export const FederationConfigSection: React.FC<
  FederationConfigSectionProps
> = ({ title, icon, description, sectionId, onMessage }) => {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [policy, setPolicy] = useState<TrustPolicyResponse | null>(null)
  const [instances, setInstances] = useState<FederationInstance[]>([])
  const [filters, setFilters] = useState<ContentFilterItem[]>([])

  // Policy draft
  const [minTrust, setMinTrust] = useState(0)
  const [allowlistText, setAllowlistText] = useState('')
  const [autoDiscover, setAutoDiscover] = useState(true)

  // New filter draft
  const [newFilterName, setNewFilterName] = useState('')
  const [newFilterType, setNewFilterType] =
    useState<(typeof FILTER_TYPES)[number]>('block_keyword')
  const [newFilterValue, setNewFilterValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, inst, f] = await Promise.all([
        federationApi.getTrustPolicy(),
        federationApi.getInstances().catch(() => ({ instances: [], total: 0 })),
        federationApi.listContentFilters().catch(() => ({ filters: [], total: 0 })),
      ])
      setPolicy(p)
      setMinTrust(p.min_trust_level ?? 0)
      setAllowlistText((p.allowed_domains || []).join('\n'))
      setAutoDiscover(p.auto_discover !== false)
      setInstances(inst.instances || [])
      setFilters(f.filters || [])
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : 'Failed to load trust policy',
        'error',
      )
    } finally {
      setLoading(false)
    }
  }, [onMessage])

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
      })
      onMessage?.(t.config.federationPolicySaved || 'Trust policy saved', 'success')
      await load()
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : 'Save failed',
        'error',
      )
    } finally {
      setSaving(false)
    }
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
      onMessage?.(e instanceof Error ? e.message : 'Update failed', 'error')
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
      onMessage?.(e instanceof Error ? e.message : 'Block failed', 'error')
    }
  }

  const addFilter = async () => {
    if (!newFilterName.trim() || !newFilterValue.trim()) {
      onMessage?.('Name and value required', 'warning')
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
      onMessage?.('Filter added', 'success')
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : 'Add filter failed', 'error')
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
      onMessage?.(e instanceof Error ? e.message : 'Update failed', 'error')
    }
  }

  const deleteFilter = async (id: number) => {
    try {
      await federationApi.deleteContentFilter(id)
      setFilters((prev) => prev.filter((x) => x.id !== id))
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : 'Delete failed', 'error')
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
        <p className="text-sm text-gray-500">{t.common?.loading || 'Loading…'}</p>
      </SettingSection>
    )
  }

  const enforcement = policy?.enforcement

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
    >
      <InfoCard
        title="Active enforcement"
        content={
          <ul className="list-disc pl-4 text-sm space-y-0.5">
            <li>
              Blocklist:{' '}
              {enforcement?.domain_blocklist ? 'on' : 'off'}
            </li>
            <li>
              Rate limit: {enforcement?.rate_limit ? 'on' : 'off'}
            </li>
            <li>
              Allowlist:{' '}
              {enforcement?.allowlist
                ? `on (${(policy?.allowed_domains || []).length} domains)`
                : 'off (empty = allow all non-blocked)'}
            </li>
            <li>
              Min trust:{' '}
              {enforcement?.min_trust_level
                ? `≥ ${policy?.min_trust_level ?? 0}`
                : 'off (0)'}
            </li>
            <li>
              Content filters:{' '}
              {enforcement?.content_filters
                ? `on (${filters.filter((f) => f.enabled).length} enabled)`
                : 'off'}
            </li>
          </ul>
        }
      />

      <SettingGroup title="Instance policy">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              Minimum trust level (inbound)
            </span>
            <select
              className="mt-1 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20"
              value={minTrust}
              onChange={(e) => setMinTrust(Number(e.target.value))}
            >
              {TRUST_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              Allowlist domains (one per line; empty = no restriction)
            </span>
            <textarea
              className="mt-1 w-full rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-sm font-mono dark:border-white/10 dark:bg-black/20"
              rows={4}
              value={allowlistText}
              onChange={(e) => setAllowlistText(e.target.value)}
              placeholder="friend.example.com"
            />
          </label>

          <SwitchItem
            itemKey="fed-auto-discover"
            label="Auto-discover instances"
            description="Unknown domains become Discovered on first contact"
            value={autoDiscover}
            onChange={setAutoDiscover}
          />

          <ButtonItem
            label="Instance policy"
            buttonText={saving ? '…' : t.common?.save || 'Save policy'}
            onClick={() => void savePolicy()}
            disabled={saving}
            loading={saving}
          />
        </div>
      </SettingGroup>

      <SettingGroup title="Known instances">
        {instances.length === 0 ? (
          <p className="text-sm text-gray-500">No instances recorded yet.</p>
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
                    <span className="ml-2 text-xs text-red-500">blocked</span>
                  )}
                </span>
                <select
                  className="rounded border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/10"
                  value={inst.trust_level}
                  onChange={(e) =>
                    void setInstanceTrust(inst.domain, Number(e.target.value))
                  }
                >
                  {TRUST_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={
                    'rounded-full px-2.5 py-1 text-xs ' +
                    (inst.blocked
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-500/10 text-red-600 dark:text-red-300')
                  }
                  onClick={() => void toggleBlock(inst.domain, !inst.blocked)}
                >
                  {inst.blocked ? 'Unblock' : 'Block'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingGroup>

      <SettingGroup title="Content filters">
        <div className="space-y-2 mb-3">
          <InputItem
            itemKey="fed-filter-name"
            label="Name"
            value={newFilterName}
            onChange={setNewFilterName}
            placeholder="spam-keyword"
          />
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Type</span>
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
                  {ft}
                </option>
              ))}
            </select>
          </label>
          <InputItem
            itemKey="fed-filter-value"
            label="Value"
            value={newFilterValue}
            onChange={setNewFilterValue}
            placeholder="keyword or activity type or trust number"
          />
          <ButtonItem
            label="Content filters"
            buttonText="Add filter"
            onClick={() => void addFilter()}
          />
        </div>
        {filters.length === 0 ? (
          <p className="text-sm text-gray-500">No content filters.</p>
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
                    {f.filter_type}={f.value}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs rounded-full px-2 py-0.5 bg-black/5 dark:bg-white/10"
                  onClick={() => void toggleFilter(f)}
                >
                  {f.enabled ? 'On' : 'Off'}
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
    </SettingSection>
  )
}

export default FederationConfigSection
