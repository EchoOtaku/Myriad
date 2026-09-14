import type { ManagedListItem, ManagedListTone } from '../../settings/ManagedList'
import {
  LuChevronDown as ChevronDown,
  LuKey as Key,
  LuEdit3 as Pencil,
  LuPlus as Plus,
  LuRefreshCw as RefreshCw,
  LuTrash2 as Trash2,
} from '@lib/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_URL } from '../../../config'
import { useI18n } from '../../../contexts/I18nContext'
import { getCSRFHeaderName, getCSRFToken } from '../../../utils/csrf'
import { showError } from '../../../utils/toastManager'
import { InputItem } from '../../settings/items/InputItem'
import { NumberItem } from '../../settings/items/NumberItem'
import { SettingsButton } from '../../settings/items/SettingsButton'
import { ToggleSwitch } from '../../settings/items/ToggleSwitch'
import { ManagedList } from '../../settings/ManagedList'
import { SettingTitleTag } from '../../settings/SettingTitleTag'
import { Spinner } from '../../Spinner'
import './RSSHubInstances.css'

const API_BASE = `${API_URL}/api/brew`

export interface RsshubInstance {
  id: number
  user_id: number | null
  name: string
  url: string
  has_access_key: boolean
  priority: number
  enabled: boolean
  health_status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  last_health_check: number | null
  last_response_time_ms: number | null
  consecutive_failures: number
  success_rate: number
  created_at: number
}

const HEALTH_TONE: Record<RsshubInstance['health_status'], ManagedListTone> = {
  healthy: 'success',
  degraded: 'warn',
  unhealthy: 'danger',
  unknown: 'muted',
}

const HEALTH_LABEL = {
  healthy: 'rsshubHealthy',
  degraded: 'rsshubDegraded',
  unhealthy: 'rsshubUnhealthy',
  unknown: 'rsshubUnknown',
} as const

async function authHeaders() {
  const cookies = document.cookie.split(';').reduce(
    (acc, cookie) => {
      const [key, value] = cookie.trim().split('=')
      acc[key] = value
      return acc
    },
    {} as Record<string, string>,
  )
  const csrfToken = await getCSRFToken(true)
  return {
    'Content-Type': 'application/json',
    ...(cookies.auth_token
      ? { Authorization: `Bearer ${cookies.auth_token}` }
      : {}),
    ...(csrfToken ? { [getCSRFHeaderName()]: csrfToken } : {}),
  }
}

function emptyDraft() {
  return { name: '', url: '', accessKey: '', priority: 100 }
}

export function RSSHubInstances({
  disabled = false,
  defaultOpen = false,
  initialUrl,
  onChange,
}: {
  disabled?: boolean
  defaultOpen?: boolean
  initialUrl?: string
  onChange: (instance: RsshubInstance | null) => void
}) {
  const { t, locale } = useI18n()
  const brew = t.brew
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const pickedRef = useRef(false)

  const [instances, setInstances] = useState<RsshubInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [panelOpen, setPanelOpen] = useState(defaultOpen)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState(emptyDraft)
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [checkingAll, setCheckingAll] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)

  const current = useMemo(
    () =>
      instances.find((item) => item.id === selectedId) ??
      instances.find((item) => item.enabled) ??
      instances[0] ??
      null,
    [instances, selectedId],
  )

  useEffect(() => {
    onChangeRef.current(current)
  }, [current])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_BASE}/rsshub/instances`, {
        headers: await authHeaders(),
      })
      const data = await response.json()
      if (!data.success) {
        showError(data.error || brew.errorLoadFailed)
        return
      }
      const next = (data.instances || []) as RsshubInstance[]
      setInstances(next)
      if (pickedRef.current) return
      pickedRef.current = true
      const matched = initialUrl
        ? next.find((item) => item.url === initialUrl)
        : undefined
      const enabled = next.find((item) => item.enabled)
      setSelectedId(matched?.id ?? enabled?.id ?? next[0]?.id ?? null)
    } catch {
      showError(brew.errorNetworkRetry)
    } finally {
      setLoading(false)
    }
  }, [brew.errorLoadFailed, brew.errorNetworkRetry, initialUrl])

  useEffect(() => {
    void load()
  }, [load])

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return brew.rsshubNever
    return new Date(timestamp).toLocaleString(locale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const handleAdd = async () => {
    if (!draft.name.trim() || !draft.url.trim()) return
    try {
      setAdding(true)
      const response = await fetch(`${API_BASE}/rsshub/instances`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          name: draft.name.trim(),
          url: draft.url.trim().replaceAll(/\/$/g, ''),
          access_key: draft.accessKey.trim() || null,
          priority: draft.priority,
        }),
      })
      const data = await response.json()
      if (!data.success) {
        showError(data.error || brew.errorAddFailed)
        return
      }
      setInstances((prev) => [...prev, data.instance])
      setSelectedId(data.instance.id)
      setFormOpen(false)
      setDraft(emptyDraft())
    } catch {
      showError(brew.errorNetworkRetry)
    } finally {
      setAdding(false)
    }
  }

  const handleUpdate = async (id: number) => {
    try {
      setSavingId(id)
      const response = await fetch(`${API_BASE}/rsshub/instances/${id}`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify({
          name: edit.name.trim() || undefined,
          url: edit.url.trim().replaceAll(/\/$/g, '') || undefined,
          access_key: edit.accessKey.trim() || undefined,
          priority: edit.priority,
        }),
      })
      const data = await response.json()
      if (!data.success) {
        showError(data.error || brew.errorUpdateFailed)
        return
      }
      setInstances((prev) =>
        prev.map((item) => (item.id === id ? data.instance : item)),
      )
      setEditingId(null)
    } catch {
      showError(brew.errorNetworkRetry)
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE}/rsshub/instances/${id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      })
      const data = await response.json()
      if (!data.success) {
        showError(data.error || brew.errorDeleteFailed)
        return
      }
      setInstances((prev) => {
        const next = prev.filter((item) => item.id !== id)
        if (selectedId === id) {
          setSelectedId(next.find((item) => item.enabled)?.id ?? next[0]?.id ?? null)
        }
        return next
      })
      if (openId === id) setOpenId(null)
      if (editingId === id) setEditingId(null)
    } catch {
      showError(brew.errorNetworkRetry)
    }
  }

  const handleToggle = async (instance: RsshubInstance) => {
    try {
      setSavingId(instance.id)
      const response = await fetch(
        `${API_BASE}/rsshub/instances/${instance.id}`,
        {
          method: 'PUT',
          headers: await authHeaders(),
          body: JSON.stringify({ enabled: !instance.enabled }),
        },
      )
      const data = await response.json()
      if (data.success) {
        setInstances((prev) =>
          prev.map((item) =>
            item.id === instance.id ? data.instance : item,
          ),
        )
      }
    } catch {
      showError(brew.errorNetworkRetry)
    } finally {
      setSavingId(null)
    }
  }

  const handleCheck = async (id: number) => {
    try {
      setCheckingId(id)
      const response = await fetch(
        `${API_BASE}/rsshub/instances/${id}/health-check`,
        { method: 'POST', headers: await authHeaders() },
      )
      const data = await response.json()
      if (data.success) await load()
    } catch {
      showError(brew.errorHealthCheckFailed)
    } finally {
      setCheckingId(null)
    }
  }

  const handleCheckAll = async () => {
    try {
      setCheckingAll(true)
      const response = await fetch(`${API_BASE}/rsshub/health-check-all`, {
        method: 'POST',
        headers: await authHeaders(),
      })
      const data = await response.json()
      if (data.success) await load()
    } catch {
      showError(brew.errorHealthCheckFailed)
    } finally {
      setCheckingAll(false)
    }
  }

  const handleReset = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE}/rsshub/instances/${id}/reset`, {
        method: 'POST',
        headers: await authHeaders(),
      })
      const data = await response.json()
      if (data.success) await load()
    } catch {
      showError(brew.errorResetFailed)
    }
  }

  const startEdit = (instance: RsshubInstance) => {
    setEditingId(instance.id)
    setOpenId(instance.id)
    setSelectedId(instance.id)
    setEdit({
      name: instance.name,
      url: instance.url,
      accessKey: '',
      priority: instance.priority,
    })
    setFormOpen(false)
    setPanelOpen(true)
  }

  const closePanel = () => {
    setPanelOpen(false)
    setFormOpen(false)
    setEditingId(null)
    setOpenId(null)
  }

  const items: ManagedListItem[] = instances.map((instance) => {
    const selected = selectedId === instance.id
    const editing = editingId === instance.id
    const busy = savingId === instance.id || checkingId === instance.id
    return {
      id: instance.id,
      title: (
        <span className="brew-rsshub-instances__name">
          {instance.name}
          {instance.has_access_key ? (
            <Key aria-label={brew.rsshubHasAccessKey} />
          ) : null}
        </span>
      ),
      subtitle: instance.url,
      className: selected ? 'is-on' : instance.enabled ? '' : 'is-off',
      busy,
      badge: {
        label: brew[HEALTH_LABEL[instance.health_status]],
        tone: instance.enabled
          ? HEALTH_TONE[instance.health_status]
          : 'muted',
      },
      trailing: (
        <ToggleSwitch
          checked={instance.enabled}
          disabled={disabled || busy}
          aria-label={
            instance.enabled ? brew.rsshubDisable : brew.rsshubEnable
          }
          onChange={() => {
            void handleToggle(instance)
          }}
        />
      ),
      expanded: openId === instance.id,
      onToggleExpand: () => {
        if (disabled) return
        setSelectedId(instance.id)
        setOpenId((cur) => (cur === instance.id ? null : instance.id))
      },
      expandContent: editing ? (
        <div className="brew-rsshub-instances__form">
          <InputItem
            itemKey={`rsshub-edit-name-${instance.id}`}
            size="sm"
            label={brew.rsshubInstanceName}
            value={edit.name}
            onChange={(name) => setEdit((prev) => ({ ...prev, name }))}
            disabled={busy}
          />
          <InputItem
            itemKey={`rsshub-edit-url-${instance.id}`}
            size="sm"
            label={brew.rsshubInstanceUrl}
            inputType="url"
            value={edit.url}
            onChange={(url) => setEdit((prev) => ({ ...prev, url }))}
            disabled={busy}
          />
          <InputItem
            itemKey={`rsshub-edit-key-${instance.id}`}
            size="sm"
            label={brew.rsshubAccessKey}
            inputType="password"
            value={edit.accessKey}
            onChange={(accessKey) =>
              setEdit((prev) => ({ ...prev, accessKey }))
            }
            placeholder={brew.rsshubAccessKeyKeep}
            disabled={busy}
          />
          <NumberItem
            itemKey={`rsshub-edit-priority-${instance.id}`}
            size="sm"
            label={brew.rsshubPriority}
            hint={brew.rsshubPriorityHint}
            value={edit.priority}
            onChange={(priority) =>
              setEdit((prev) => ({ ...prev, priority }))
            }
            min={0}
            max={999}
            disabled={busy}
          />
          <div className="managed-list-form-actions">
            <SettingsButton
              size="sm"
              onClick={() => setEditingId(null)}
              disabled={busy}
            >
              {brew.cancel}
            </SettingsButton>
            <SettingsButton
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!edit.name.trim() || !edit.url.trim()}
              onClick={() => void handleUpdate(instance.id)}
            >
              {brew.save}
            </SettingsButton>
          </div>
        </div>
      ) : (
        <div className="brew-rsshub-instances__detail">
          <div className="brew-rsshub-instances__metrics">
            <span>
              <small>{brew.rsshubPriority}</small>
              {instance.priority}
            </span>
            <span>
              <small>{brew.rsshubSuccessRate}</small>
              {instance.success_rate.toFixed(0)}%
            </span>
            <span>
              <small>{brew.rsshubResponse}</small>
              {instance.last_response_time_ms
                ? `${instance.last_response_time_ms}ms`
                : '—'}
            </span>
            <span>
              <small>{brew.rsshubLastCheck}</small>
              {formatTime(instance.last_health_check)}
            </span>
          </div>
          <div className="brew-rsshub-instances__detail-actions">
            <SettingsButton
              size="sm"
              variant="ghost"
              icon={<RefreshCw />}
              loading={checkingId === instance.id}
              disabled={disabled || busy}
              onClick={() => void handleCheck(instance.id)}
            >
              {brew.rsshubCheck}
            </SettingsButton>
            <SettingsButton
              size="sm"
              variant="ghost"
              icon={<Pencil />}
              disabled={disabled || busy}
              onClick={() => startEdit(instance)}
            >
              {brew.edit}
            </SettingsButton>
            <SettingsButton
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => void handleReset(instance.id)}
            >
              {brew.rsshubReset}
            </SettingsButton>
            <SettingsButton
              size="sm"
              variant="danger"
              icon={<Trash2 />}
              confirm={brew.rsshubConfirmDelete}
              disabled={disabled || busy}
              onClick={() => void handleDelete(instance.id)}
            >
              {brew.delete}
            </SettingsButton>
          </div>
        </div>
      ),
    }
  })

  const healthVariant =
    !current?.enabled || current.health_status === 'unknown'
      ? 'muted'
      : current.health_status === 'healthy'
        ? 'default'
        : 'danger'

  return (
    <div
      className={`brew-rsshub-instances${panelOpen ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <button
        type="button"
        className="brew-rsshub-instances__summary"
        disabled={disabled}
        aria-expanded={panelOpen}
        onClick={() => {
          if (disabled) return
          if (panelOpen) closePanel()
          else setPanelOpen(true)
        }}
      >
        <span className="brew-rsshub-instances__summary-main">
          <span className="brew-rsshub-instances__summary-name">
            {loading ? brew.loading : current?.name ?? brew.rsshubNoInstance}
            {current?.has_access_key ? <Key /> : null}
          </span>
          <span className="brew-rsshub-instances__summary-url">
            {current?.url ?? brew.rsshubClickToAdd}
          </span>
        </span>
        <span className="brew-rsshub-instances__summary-side">
          {loading ? (
            <Spinner size="xs" />
          ) : current ? (
            <SettingTitleTag variant={healthVariant}>
              {brew[HEALTH_LABEL[current.health_status]]}
            </SettingTitleTag>
          ) : null}
          {instances.length > 0 ? (
            <SettingTitleTag variant="muted">
              {instances.length}
            </SettingTitleTag>
          ) : null}
          <ChevronDown className="brew-rsshub-instances__chevron" />
        </span>
      </button>

      {panelOpen ? (
        <div className="brew-rsshub-instances__panel">
          <div className="brew-rsshub-instances__bar">
            <SettingsButton
              size="sm"
              variant="ghost"
              icon={<RefreshCw />}
              loading={checkingAll}
              disabled={disabled || loading || instances.length === 0}
              onClick={() => void handleCheckAll()}
            >
              {brew.rsshubCheckAll}
            </SettingsButton>
            <SettingsButton
              size="sm"
              icon={<Plus />}
              disabled={disabled}
              variant={formOpen ? 'ghost' : 'primary'}
              onClick={() => {
                setFormOpen((open) => !open)
                setEditingId(null)
                if (formOpen) setDraft(emptyDraft())
              }}
            >
              {formOpen ? brew.cancel : brew.rsshubAddInstance}
            </SettingsButton>
          </div>

          {formOpen ? (
            <div className="brew-rsshub-instances__form">
              <InputItem
                itemKey="rsshub-new-name"
                size="sm"
                label={brew.rsshubInstanceName}
                value={draft.name}
                onChange={(name) => setDraft((prev) => ({ ...prev, name }))}
                disabled={adding}
              />
              <InputItem
                itemKey="rsshub-new-url"
                size="sm"
                label={brew.rsshubInstanceUrl}
                inputType="url"
                value={draft.url}
                onChange={(url) => setDraft((prev) => ({ ...prev, url }))}
                placeholder="https://rsshub.app"
                disabled={adding}
              />
              <InputItem
                itemKey="rsshub-new-key"
                size="sm"
                label={brew.rsshubAccessKey}
                inputType="password"
                value={draft.accessKey}
                onChange={(accessKey) =>
                  setDraft((prev) => ({ ...prev, accessKey }))
                }
                disabled={adding}
              />
              <NumberItem
                itemKey="rsshub-new-priority"
                size="sm"
                label={brew.rsshubPriority}
                hint={brew.rsshubPriorityHint}
                value={draft.priority}
                onChange={(priority) =>
                  setDraft((prev) => ({ ...prev, priority }))
                }
                min={0}
                max={999}
                disabled={adding}
              />
              <div className="managed-list-form-actions">
                <SettingsButton
                  size="sm"
                  variant="primary"
                  loading={adding}
                  disabled={!draft.name.trim() || !draft.url.trim()}
                  onClick={() => void handleAdd()}
                >
                  {brew.add}
                </SettingsButton>
              </div>
            </div>
          ) : null}

          <ManagedList
            className="brew-rsshub-instances__list"
            loading={loading && instances.length === 0}
            working={adding || checkingAll}
            maxHeight="11rem"
            items={items}
            emptyText={loading ? brew.loading : brew.rsshubNoInstances}
          />
        </div>
      ) : null}
    </div>
  )
}
