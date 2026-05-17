/**
 * Updater 内联面板（admin 在「关于」section 中看到的更新管理界面）。
 *
 * 视觉层级（状态优先 vs 信息倾倒）：
 *   1. Hero 状态卡 — 一眼看出"现在处于什么状态、下一步该做什么"
 *   2. 进度卡    — 仅在有任务运行时显示，带进度条
 *   3. 折叠区块  — 快照、高级与诊断（默认收起，admin 不会被技术细节淹没）
 *
 * 实现遵循 docs/updater-spec.md §13。Backend mode 走 admin session + CSRF +
 * 服务器持有 UPDATE_TOKEN；direct mode 是运维 fallback，需 PROXY_ALLOW_DIRECT_UPDATER。
 */

import type { Job, LatestAvailable, ReleaseManifest, SnapshotMeta, TransportMode, UpdaterStatus } from '../../services/updaterApi'
import { LuAlertTriangle, LuDownload, LuRefreshCw, LuRotateCw, LuShieldCheck } from '@lib/icons'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { detectVersionDrift, makeUpdaterApi, UpdaterError } from '../../services/updaterApi'
import { ButtonItem, SettingGroup } from '../settings'
import './UpdaterConfigSection.css'

const POLL_INTERVAL = 4_000
const TEMPLATE_RE = /\{(\w+)\}/g

function format(template: string, params: Record<string, string>): string {
  return template.replace(TEMPLATE_RE, (_, k) => params[k] ?? `{${k}}`)
}

export interface UpdaterInlinePanelProps {
  heading?: string
}

type Toast = { kind: 'info' | 'error' | 'ok', text: string } | null

type HeroKind = 'healthy' | 'available' | 'updating' | 'maintenance' | 'needsManual' | 'offline' | 'firstRun'

interface HeroInfo {
  kind: HeroKind
  title: string
  subtitle: string
}

export const UpdaterInlinePanel: React.FC<UpdaterInlinePanelProps> = ({ heading }) => {
  const { t } = useI18n()
  const u = t.config

  const [mode, setMode] = useState<TransportMode>('backend')
  const [token, setToken] = useState('')
  const api = useMemo(
    () => makeUpdaterApi({ mode, token: mode === 'direct' ? token : undefined }),
    [mode, token],
  )

  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [available, setAvailable] = useState<ReleaseManifest | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [drift, setDrift] = useState<{ build: string, current: string } | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  const pollRef = useRef<number | null>(null)
  const tokenRequired = mode === 'direct' && !token

  const explain = useCallback((e: unknown): string => {
    if (e instanceof UpdaterError) {
      if (e.status === 401)
        return u.updaterErr401
      if (e.status === 403)
        return u.updaterErr403
      if (e.status === 409)
        return u.updaterErr409
      if (e.status === 412)
        return `${u.updaterErr412}: ${e.message}`
      return `${e.status}: ${e.message}`
    }
    return String(e)
  }, [u])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      let s: UpdaterStatus | null = null
      try {
        s = await api.status()
        if (mode === 'backend' && accessDenied)
          setAccessDenied(false)
      }
      catch (e) {
        if (mode === 'backend' && e instanceof UpdaterError && (e.status === 401 || e.status === 403)) {
          setAccessDenied(true)
          setStatus(null)
          setSnapshots([])
          setActiveJob(null)
          return
        }
      }
      const snaps = await api
        .snapshots()
        .catch(() => ({ schema_version: 1, items: [] as SnapshotMeta[] }))
      setStatus(s)
      setSnapshots(snaps.items ?? [])
      if (s?.job_in_flight) {
        const j = await api.job(s.job_in_flight).catch(() => null)
        setActiveJob(j)
      }
      else {
        setActiveJob(null)
      }
    }
    finally {
      setLoading(false)
    }
  }, [api, mode, accessDenied])

  useEffect(() => {
    refresh()
    detectVersionDrift().then((d) => {
      if (d?.drift)
        setDrift({ build: d.build, current: d.current })
    })
  }, [refresh])

  useEffect(() => {
    if (status?.job_in_flight) {
      pollRef.current = window.setInterval(refresh, POLL_INTERVAL)
    }
    else if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current)
        window.clearInterval(pollRef.current)
    }
  }, [status?.job_in_flight, refresh])

  // ===== Actions =====

  const checkAvailable = useCallback(async () => {
    setBusy('check')
    setToast(null)
    try {
      const manifest = await api.available()
      setAvailable(manifest)
      if (!manifest)
        setToast({ kind: 'info', text: u.updaterNoAvailable })
      await refresh()
    }
    catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    }
    finally {
      setBusy(null)
    }
  }, [api, refresh, explain, u.updaterNoAvailable])

  const triggerUpgrade = useCallback(async () => {
    const target = available?.version ?? status?.latest_available?.version
    if (!target)
      return
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    if (!confirm(format(u.updaterConfirmUpgrade, { version: target })))
      return
    setBusy('upgrade')
    setToast(null)
    try {
      // 若 available manifest 还没拉过，先拿一次以便用最新 version
      let resolvedTarget = target
      if (!available) {
        const m = await api.available().catch(() => null)
        if (m) {
          setAvailable(m)
          resolvedTarget = m.version
        }
      }
      const r = await api.triggerUpdate(
        resolvedTarget,
        `update-${resolvedTarget}-${Date.now()}`,
      )
      setToast({ kind: 'ok', text: format(u.updaterDispatched, { jobId: r.job_id }) })
      await refresh()
    }
    catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    }
    finally {
      setBusy(null)
    }
  }, [api, available, status, refresh, tokenRequired, explain, u])

  const triggerSelfUpdate = useCallback(async () => {
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    const target = status?.latest_available?.version ?? ''
    if (!target)
      return
    if (!confirm(format(u.updaterSelfUpdateConfirm, { version: target })))
      return
    setBusy('self-update')
    setToast(null)
    try {
      const r = await api.triggerSelfUpdate()
      setToast({
        kind: 'ok',
        text: format(u.updaterSelfUpdateDispatched, { helper: r.helper_container_id.slice(0, 12) }),
      })
    }
    catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    }
    finally {
      setBusy(null)
    }
  }, [api, status, tokenRequired, explain, u])

  const rollbackTo = useCallback(async (snapshotId: string) => {
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    if (!confirm(format(u.updaterConfirmRollback, { snapshotId })))
      return
    setBusy(`rollback-${snapshotId}`)
    try {
      await api.rollback(snapshotId)
      setToast({ kind: 'ok', text: u.updaterRollbackDispatched })
      await refresh()
    }
    catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    }
    finally {
      setBusy(null)
    }
  }, [api, refresh, tokenRequired, explain, u])

  const exitMaintenance = useCallback(async () => {
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    if (!confirm(u.updaterConfirmExitMaintenance))
      return
    setBusy('exit-maintenance')
    try {
      await api.exitMaintenance()
      setToast({ kind: 'ok', text: u.updaterMaintenanceExited })
      await refresh()
    }
    catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    }
    finally {
      setBusy(null)
    }
  }, [api, refresh, tokenRequired, explain, u])

  // ===== 派生：当前 hero 状态 =====
  const hero = useMemo<HeroInfo>(() => deriveHero(status, u), [status, u])

  // 非 admin：整段折叠
  if (accessDenied && mode === 'backend')
    return null

  // ===== Render =====

  const showProgress = !!activeJob && !['succeeded', 'failed'].includes(activeJob.status)
  const showExitMaintenance = !!status?.maintenance_active && !showProgress
  const showSelfUpdate = !!status?.requires_self_update && !!status.latest_available

  return (
    <div className="updater-panel">
      {heading && <h3 className="updater-panel-heading">{heading}</h3>}

      {drift && (
        <div className="updater-drift">
          {format(u.updaterDriftWarn, drift)}
          {' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              location.reload()
            }}
          >
            {u.updaterDriftAction}
          </a>
        </div>
      )}

      {/* ===== 1. Hero 状态卡 ===== */}
      <Hero
        info={hero}
        status={status}
        loading={loading}
        u={u}
        primaryButton={renderPrimaryAction({
          status,
          u,
          busy,
          tokenRequired,
          hero,
          onCheck: checkAvailable,
          onUpgrade: triggerUpgrade,
        })}
      />

      {toast && (
        <div className={`updater-toast ${toast.kind}`}>
          <span>{toast.text}</span>
        </div>
      )}

      {/* ===== 2. 进度卡（条件渲染） ===== */}
      {showProgress && <ProgressCard job={activeJob!} u={u} />}

      {/* ===== 3. 应急/危险操作（仅必要时显示） ===== */}
      {(showExitMaintenance || showSelfUpdate) && (
        <SettingGroup>
          {showSelfUpdate && (
            <ButtonItem
              itemKey="self_update"
              label={u.updaterSelfUpdateButton}
              description={u.updaterActionSelfUpdateDesc}
              buttonText={busy === 'self-update' ? u.updaterSelfUpdateDispatching : u.updaterSelfUpdateButton}
              buttonIcon={<LuShieldCheck size={14} />}
              onClick={triggerSelfUpdate}
              variant="primary"
              layout="horizontal"
              disabled={busy === 'self-update' || tokenRequired}
            />
          )}
          {showExitMaintenance && (
            <ButtonItem
              itemKey="exit_maintenance"
              label={u.updaterForceExit}
              description={u.updaterActionExitDesc}
              buttonText={busy === 'exit-maintenance' ? u.updaterProcessing : u.updaterForceExit}
              buttonIcon={<LuAlertTriangle size={14} />}
              onClick={exitMaintenance}
              variant="danger"
              layout="horizontal"
              disabled={busy === 'exit-maintenance' || tokenRequired}
            />
          )}
        </SettingGroup>
      )}

      {/* ===== 4. 快照与历史（折叠）===== */}
      <SettingGroup
        title={u.updaterGroupHistory}
        description={u.updaterGroupHistoryDesc}
        collapsible
        defaultExpanded={false}
      >
        {snapshots.length === 0
          ? (<p className="updater-empty">{u.updaterNoSnapshots}</p>)
          : (
              <div className="updater-snapshot-list">
                {snapshots.map(s => (
                  <SnapshotRow
                    key={s.id}
                    snapshot={s}
                    u={u}
                    busy={busy === `rollback-${s.id}`}
                    disabled={tokenRequired}
                    onRollback={() => rollbackTo(s.id)}
                  />
                ))}
              </div>
            )}
      </SettingGroup>

      {/* ===== 5. 高级与诊断（折叠）===== */}
      <SettingGroup
        title={u.updaterGroupAdvanced}
        description={u.updaterGroupAdvancedDesc}
        collapsible
        defaultExpanded={false}
      >
        <AdvancedPanel
          status={status}
          available={available}
          mode={mode}
          token={token}
          loading={loading}
          busy={busy}
          u={u}
          onModeChange={(m) => {
            setMode(m)
            if (m === 'backend')
              setToken('')
          }}
          onTokenChange={setToken}
          onRefresh={refresh}
        />
      </SettingGroup>
    </div>
  )
}

// ===== 子组件：Hero =====

function Hero({
  info,
  status,
  loading,
  u,
  primaryButton,
}: {
  info: HeroInfo
  status: UpdaterStatus | null
  loading: boolean
  u: ReturnType<typeof useI18n>['t']['config']
  primaryButton: React.ReactNode
}) {
  return (
    <div className={`updater-hero ${info.kind}`}>
      <div className="updater-hero-head">
        <span className="updater-hero-dot" />
        <div className="updater-hero-body">
          <h4 className="updater-hero-title">{info.title}</h4>
          <p className="updater-hero-subtitle">{info.subtitle}</p>
          <VersionLine status={status} u={u} />
          {status?.last_checked_at && (
            <p className="updater-hero-meta">
              {u.updaterLastChecked}
              ：
              {formatAgo(status.last_checked_at, u)}
            </p>
          )}
          {loading && !status && (
            <p className="updater-hero-meta">{u.updaterLoading}</p>
          )}
        </div>
      </div>
      <div className="updater-hero-actions">{primaryButton}</div>
    </div>
  )
}

function VersionLine({
  status,
  u,
}: {
  status: UpdaterStatus | null
  u: ReturnType<typeof useI18n>['t']['config']
}) {
  if (!status)
    return null
  const current = status.current_version
  const latest = status.latest_available?.version
  if (!current && !latest)
    return null
  return (
    <div className="updater-hero-versions">
      {current && (
        <span>
          {u.updaterCurrentVersion}
          ：
          <code>{current}</code>
        </span>
      )}
      {latest && latest !== current && (
        <>
          <span className="arrow">→</span>
          <span>
            <code>{latest}</code>
          </span>
        </>
      )}
      {status.channel && (
        <span>
          ·
          {status.channel}
        </span>
      )}
    </div>
  )
}

// ===== 子组件：主操作按钮 =====

function renderPrimaryAction({
  status,
  u,
  busy,
  tokenRequired,
  hero,
  onCheck,
  onUpgrade,
}: {
  status: UpdaterStatus | null
  u: ReturnType<typeof useI18n>['t']['config']
  busy: string | null
  tokenRequired: boolean
  hero: HeroInfo
  onCheck: () => void
  onUpgrade: () => void
}) {
  // 优先级：可升级 > 维护中(无主操作) > 首次/正常
  const canUpgrade = hero.kind === 'available' && !!status?.latest_available
  const target = status?.latest_available?.version

  return (
    <>
      {canUpgrade && target && (
        <button
          type="button"
          className="btn-base btn-primary"
          onClick={onUpgrade}
          disabled={busy === 'upgrade' || !!status?.job_in_flight || tokenRequired}
        >
          <LuDownload size={14} />
          <span>
            {busy === 'upgrade' ? u.updaterDispatching : format(u.updaterUpgradeTo, { version: target })}
          </span>
        </button>
      )}
      <button
        type="button"
        className={canUpgrade ? 'btn-base btn-secondary' : 'btn-base btn-primary'}
        onClick={onCheck}
        disabled={busy === 'check'}
      >
        <LuRefreshCw size={14} />
        <span>{busy === 'check' ? u.updaterChecking : u.updaterCheckAvailable}</span>
      </button>
    </>
  )
}

// ===== 子组件：进度卡 =====

function ProgressCard({
  job,
  u,
}: {
  job: Job
  u: ReturnType<typeof useI18n>['t']['config']
}) {
  const done = job.steps.filter(s => s.ok === true).length
  const total = Math.max(job.steps.length, done + 1)
  const pct = Math.min(99, Math.round((done / total) * 100))
  const currentStep = job.steps.at(-1)
  const phaseLabel = currentStep?.phase ?? job.status
  return (
    <div className="updater-progress">
      <div className="updater-progress-head">
        <span className="updater-progress-phase">
          {format(u.updaterTaskProgress, { jobId: job.id.slice(0, 8) })}
          {' '}
          ·
          {phaseLabel}
        </span>
        <span className="updater-progress-counts">
          {done}
          {' '}
          /
          {' '}
          {total}
        </span>
      </div>
      <div className="updater-progress-bar">
        <div
          className={`updater-progress-bar-fill ${currentStep?.finished_at ? '' : 'indeterminate'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <details className="updater-progress-details">
        <summary>{u.updaterStepLog}</summary>
        <ol className="updater-progress-steps">
          {job.steps.map((s, i) => (
            <li key={i}>
              <span className={s.ok === true ? 'updater-step-ok' : s.ok === false ? 'updater-step-err' : ''}>
                <code>{s.phase}</code>
              </span>
              {s.error && <span className="updater-step-err-msg">{s.error}</span>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

// ===== 子组件：快照行 =====

function SnapshotRow({
  snapshot,
  u,
  busy,
  disabled,
  onRollback,
}: {
  snapshot: SnapshotMeta
  u: ReturnType<typeof useI18n>['t']['config']
  busy: boolean
  disabled: boolean
  onRollback: () => void
}) {
  return (
    <div className="updater-snapshot-item">
      <div className="updater-snapshot-meta">
        <div className="updater-snapshot-version">
          {snapshot.source_version
            ? <code>{snapshot.source_version}</code>
            : <span style={{ color: '#9ca3af' }}>—</span>}
        </div>
        <div className="updater-snapshot-info">
          {new Date(snapshot.created_at).toLocaleString()}
          {' '}
          ·
          {formatBytes(snapshot.size_bytes)}
        </div>
      </div>
      <button
        type="button"
        className="btn-base btn-secondary"
        onClick={onRollback}
        disabled={busy || disabled}
      >
        <LuRotateCw size={13} />
        <span>{u.updaterRollback}</span>
      </button>
    </div>
  )
}

// ===== 子组件：高级面板 =====

function AdvancedPanel({
  status,
  available,
  mode,
  token,
  loading,
  busy,
  u,
  onModeChange,
  onTokenChange,
  onRefresh,
}: {
  status: UpdaterStatus | null
  available: ReleaseManifest | null
  mode: TransportMode
  token: string
  loading: boolean
  busy: string | null
  u: ReturnType<typeof useI18n>['t']['config']
  onModeChange: (m: TransportMode) => void
  onTokenChange: (s: string) => void
  onRefresh: () => void
}) {
  const _ = busy // reserved for future per-row spinners
  void _
  return (
    <>
      <dl className="updater-detail-grid">
        <dt>{u.updaterUpdaterVersion}</dt>
        <dd>{status?.updater_version ?? '—'}</dd>
        <dt>{u.updaterChannel}</dt>
        <dd>{status?.channel ?? '—'}</dd>
        <dt>{u.updaterTransport}</dt>
        <dd>{mode === 'backend' ? u.updaterTransportBackend : u.updaterTransportDirect}</dd>
        <dt>{u.updaterJobInFlight}</dt>
        <dd>{status?.job_in_flight ?? u.updaterNone}</dd>
      </dl>

      {available && (
        <details style={{ marginTop: '0.6rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: '#6b7280' }}>
            {u.updaterImageDigests}
          </summary>
          <dl className="updater-detail-grid" style={{ marginTop: '0.4rem' }}>
            {Object.entries(available.images).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v.digest}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
      )}

      <div style={{ marginTop: '0.85rem' }}>
        <div className="updater-mode-row">
          <label>
            <input
              type="radio"
              name="updater-mode"
              checked={mode === 'backend'}
              onChange={() => onModeChange('backend')}
            />
            {u.updaterModeBackend}
          </label>
          <label>
            <input
              type="radio"
              name="updater-mode"
              checked={mode === 'direct'}
              onChange={() => onModeChange('direct')}
            />
            {u.updaterModeDirect}
          </label>
        </div>
        {mode === 'direct' && (
          <input
            type="password"
            value={token}
            onChange={e => onTokenChange(e.target.value)}
            placeholder="UPDATE_TOKEN"
            className="updater-token-input"
            autoComplete="off"
          />
        )}
      </div>

      <div style={{ marginTop: '0.85rem' }}>
        <button
          type="button"
          className="btn-base btn-secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          <LuRefreshCw size={13} />
          <span>{u.updaterRefresh}</span>
        </button>
      </div>
    </>
  )
}

// ===== 派生 hero 状态 =====

function deriveHero(
  status: UpdaterStatus | null,
  u: ReturnType<typeof useI18n>['t']['config'],
): HeroInfo {
  if (!status)
    return { kind: 'offline', title: u.updaterStatusOffline, subtitle: u.updaterStatusOfflineDesc }
  if (status.job_in_flight)
    return { kind: 'updating', title: u.updaterStatusUpdating, subtitle: u.updaterStatusUpdatingDesc }
  if (status.maintenance_phase === 'needs_manual')
    return { kind: 'needsManual', title: u.updaterStatusNeedsManual, subtitle: u.updaterStatusNeedsManualDesc }
  if (status.maintenance_active)
    return { kind: 'maintenance', title: u.updaterStatusMaintenance, subtitle: u.updaterStatusMaintenanceDesc }
  if (!status.current_version)
    return { kind: 'firstRun', title: u.updaterStatusFirstRun, subtitle: u.updaterStatusFirstRunDesc }
  if (status.update_available)
    return { kind: 'available', title: u.updaterStatusAvailable, subtitle: u.updaterStatusAvailableDesc }
  return { kind: 'healthy', title: u.updaterStatusHealthy, subtitle: u.updaterStatusHealthyDesc }
}

// ===== 辅助 =====

function _unusedLatest(la: LatestAvailable | null | undefined) {
  return la
}
void _unusedLatest

function formatBytes(n: number): string {
  if (n < 1024)
    return `${n} B`
  if (n < 1024 ** 2)
    return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3)
    return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function formatAgo(iso: string, u: ReturnType<typeof useI18n>['t']['config']): string {
  const then = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (diffSec < 45)
    return u.updaterAgoJustNow
  const min = Math.round(diffSec / 60)
  if (min < 60)
    return format(u.updaterAgoMin, { n: String(min) })
  const hr = Math.round(min / 60)
  if (hr < 24)
    return format(u.updaterAgoHour, { n: String(hr) })
  const d = Math.round(hr / 24)
  return format(u.updaterAgoDay, { n: String(d) })
}

export default UpdaterInlinePanel
