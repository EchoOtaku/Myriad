/**
 * Updater 内联面板 — 极简设计。
 *
 * 日常使用只显示：
 *   - 当前版本
 *   - 状态（一句话：已是最新 / 有新版本 / 升级中 / 维护中 / 异常）
 *   - 上次检查时间
 *   - 一个主按钮（"检查更新" 或 "升级到 vX"）
 *
 * 任务进行中：进度卡接替主信息卡。
 * 异常/危险操作：默认折叠在「维护操作」「快照」「高级」三组里。
 *
 * 风格沿用 about-row（与上方的版本/协议/组织/仓库一致）。
 */

import type {
  CommitListItem,
  CompareResult,
  Job,
  ReleaseListItem,
  ReleaseManifest,
  SnapshotMeta,
  TransportMode,
  UpdateMode,
  UpdaterStatus,
} from '../../services/updaterApi'
import { LuRefreshCw } from '@lib/icons'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import {
  detectVersionDrift,
  makeUpdaterApi,
  UpdaterError,
} from '../../services/updaterApi'
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

type Toast = { kind: 'ok' | 'error'; text: string } | null

/** 派生状态：决定状态行文案和主按钮行为。 */
type Mood =
  | 'healthy'
  | 'available'
  | 'downgrade'
  | 'updating'
  | 'maintenance'
  | 'needsManual'
  | 'offline'
  | 'firstRun'

export const UpdaterInlinePanel: React.FC<UpdaterInlinePanelProps> = ({
  heading,
}) => {
  const { t } = useI18n()
  const u = t.config

  const [mode, setMode] = useState<TransportMode>('backend')
  const [token, setToken] = useState('')
  const api = useMemo(
    () =>
      makeUpdaterApi({ mode, token: mode === 'direct' ? token : undefined }),
    [mode, token],
  )

  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [available, setAvailable] = useState<ReleaseManifest | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [drift, setDrift] = useState<{ build: string; current: string } | null>(
    null,
  )
  const [accessDenied, setAccessDenied] = useState(false)
  /** Local drafts for channel / update-mode before apply. */
  const [draftChannel, setDraftChannel] = useState<string>('stable')
  const [draftUpdateMode, setDraftUpdateMode] = useState<UpdateMode>('release')
  const [commitInput, setCommitInput] = useState('')
  const [commitList, setCommitList] = useState<CommitListItem[]>([])
  const [commitListBranch, setCommitListBranch] = useState<string>('')
  const [releaseList, setReleaseList] = useState<ReleaseListItem[]>([])
  const [comparePreview, setComparePreview] = useState<CompareResult | null>(
    null,
  )
  const [selectedRelease, setSelectedRelease] = useState<string>('')
  /** Only hydrate draft selectors from server once (or after explicit prefs save). */
  const draftsHydratedRef = useRef(false)
  const compareTimerRef = useRef<number | null>(null)

  const pollRef = useRef<number | null>(null)
  const tokenRequired = mode === 'direct' && !token

  const explain = useCallback(
    (e: unknown): string => {
      if (e instanceof UpdaterError) {
        if (e.status === 401) return u.updaterErr401
        if (e.status === 403) return u.updaterErr403
        if (e.status === 409) return u.updaterErr409
        if (e.status === 412) return `${u.updaterErr412}: ${e.message}`
        if (e.status === 503 && /not configured/i.test(e.message))
          return u.updaterErrNotConfigured
        return `${e.status}: ${e.message}`
      }
      return String(e)
    },
    [u],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      let s: UpdaterStatus | null = null
      try {
        s = await api.status()
        if (mode === 'backend' && accessDenied) setAccessDenied(false)
      } catch (e) {
        if (
          mode === 'backend' &&
          e instanceof UpdaterError &&
          (e.status === 401 || e.status === 403)
        ) {
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
      if (s && !draftsHydratedRef.current) {
        setDraftChannel(s.channel || 'stable')
        setDraftUpdateMode(s.update_mode === 'commit' ? 'commit' : 'release')
        draftsHydratedRef.current = true
      }
      if (s?.job_in_flight) {
        const j = await api.job(s.job_in_flight).catch(() => null)
        setActiveJob(j)
      } else {
        setActiveJob(null)
      }
    } finally {
      setLoading(false)
    }
  }, [api, mode, accessDenied])

  useEffect(() => {
    refresh()
    detectVersionDrift().then((d) => {
      if (d?.drift) setDrift({ build: d.build, current: d.current })
    })
  }, [refresh])

  useEffect(() => {
    if (status?.job_in_flight) {
      pollRef.current = window.setInterval(refresh, POLL_INTERVAL)
    } else if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [status?.job_in_flight, refresh])

  const channelOptions = useMemo(() => {
    if (draftUpdateMode === 'commit') {
      return status?.available_channels?.length
        ? status.available_channels
        : ['main', 'preview', 'beta']
    }
    return status?.available_channels?.length
      ? status.available_channels
      : ['stable', 'beta', 'nightly']
  }, [draftUpdateMode, status?.available_channels])

  // ===== Actions =====

  const applyPrefs = useCallback(async () => {
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    setBusy('prefs')
    setToast(null)
    try {
      const prefs = await api.setPrefs({
        channel: draftChannel,
        mode: draftUpdateMode,
      })
      setDraftChannel(prefs.channel)
      setDraftUpdateMode(prefs.mode === 'commit' ? 'commit' : 'release')
      draftsHydratedRef.current = true
      setAvailable(null)
      setToast({ kind: 'ok', text: u.updaterPrefsSaved })
      await refresh()
    } catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    } finally {
      setBusy(null)
    }
  }, [
    api,
    draftChannel,
    draftUpdateMode,
    refresh,
    tokenRequired,
    explain,
    u,
  ])

  const loadCommits = useCallback(async () => {
    if (draftUpdateMode !== 'commit') {
      setCommitList([])
      return
    }
    try {
      const res = await api.commits({ branch: draftChannel, limit: 25 })
      setCommitList(res.items ?? [])
      setCommitListBranch(res.branch ?? draftChannel)
    } catch {
      setCommitList([])
    }
  }, [api, draftChannel, draftUpdateMode])

  const loadReleases = useCallback(async () => {
    if (draftUpdateMode !== 'release') {
      setReleaseList([])
      return
    }
    try {
      const res = await api.releases({ channel: draftChannel, limit: 25 })
      setReleaseList(res.items ?? [])
    } catch {
      setReleaseList([])
    }
  }, [api, draftChannel, draftUpdateMode])

  // Debounced compare preview when typing a commit/tag target.
  useEffect(() => {
    if (compareTimerRef.current) {
      window.clearTimeout(compareTimerRef.current)
      compareTimerRef.current = null
    }
    const target =
      draftUpdateMode === 'commit'
        ? commitInput.trim()
        : selectedRelease.trim()
    if (!target || target.length < 3) {
      setComparePreview(null)
      return
    }
    compareTimerRef.current = window.setTimeout(() => {
      api
        .compare(target)
        .then(setComparePreview)
        .catch(() => setComparePreview(null))
    }, 450)
    return () => {
      if (compareTimerRef.current) window.clearTimeout(compareTimerRef.current)
    }
  }, [api, commitInput, selectedRelease, draftUpdateMode])

  const checkAvailable = useCallback(async () => {
    setBusy('check')
    setToast(null)
    try {
      // Ephemeral check only — does not write prefs. Use「应用频道设置」to persist.
      const manifest = await api.available({
        channel: draftChannel,
        mode: draftUpdateMode,
      })
      setAvailable(manifest)
      if (!manifest) setToast({ kind: 'ok', text: u.updaterNoAvailable })
      if (draftUpdateMode === 'commit') await loadCommits()
      else await loadReleases()
      // Refresh status for job/maintenance only; do not re-hydrate drafts.
      await refresh()
    } catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    } finally {
      setBusy(null)
    }
  }, [
    api,
    draftChannel,
    draftUpdateMode,
    refresh,
    explain,
    u.updaterNoAvailable,
    loadCommits,
    loadReleases,
  ])

  const triggerUpgrade = useCallback(
    async (opts?: { forceDowngrade?: boolean }) => {
      const updateMode: UpdateMode =
        draftUpdateMode === 'commit' ? 'commit' : 'release'
      const target =
        updateMode === 'commit' && commitInput.trim()
          ? commitInput.trim()
          : selectedRelease.trim() ||
            available?.version ||
            status?.latest_available?.version
      if (!target) return
      if (tokenRequired) {
        setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
        return
      }

      const isDowngrade =
        !!opts?.forceDowngrade ||
        comparePreview?.is_downgrade === true ||
        status?.downgrade_available === true ||
        available?.is_downgrade === true ||
        status?.latest_available?.is_downgrade === true
      const relation =
        comparePreview?.relation ??
        available?.relation ??
        status?.latest_available?.relation
      const needsRisk =
        relation === 'diverged' ||
        relation === 'unknown' ||
        (!isDowngrade &&
          !comparePreview?.is_upgrade &&
          !status?.update_available &&
          available?.is_upgrade !== true)

      if (isDowngrade) {
        if (
          !confirm(
            format(u.updaterConfirmDowngrade, {
              version: target,
              current: status?.current_version ?? '—',
            }),
          )
        ) {
          return
        }
      } else if (needsRisk) {
        if (!confirm(u.updaterConfirmRisk)) return
      } else if (!confirm(format(u.updaterConfirmUpgrade, { version: target }))) {
        return
      }

      setBusy('upgrade')
      setToast(null)
      try {
        let resolvedTarget = target
        if (!available && !(updateMode === 'commit' && commitInput.trim())) {
          const m = await api
            .available({ channel: draftChannel, mode: updateMode })
            .catch(() => null)
          if (m) {
            setAvailable(m)
            resolvedTarget = m.version
          }
        }
        const r = await api.triggerUpdate(resolvedTarget, {
          mode: updateMode,
          commit: updateMode === 'commit',
          allowDowngrade: isDowngrade,
          allowRisk: needsRisk || isDowngrade,
          idemKey: `update-${resolvedTarget}-${Date.now()}`,
        })
        setToast({
          kind: 'ok',
          text: format(u.updaterDispatched, { jobId: r.job_id }),
        })
        await refresh()
      } catch (e) {
        // Server rejected missing allow_downgrade / allow_risk — re-prompt.
        if (
          e instanceof UpdaterError &&
          e.status === 412 &&
          /allow_downgrade|downgrade|allow_risk|diverged|unknown|irreversible/i.test(
            e.message,
          )
        ) {
          const msg = /irreversible|diverged|unknown|allow_risk/i.test(e.message)
            ? u.updaterConfirmRisk
            : format(u.updaterConfirmDowngrade, {
                version: target,
                current: status?.current_version ?? '—',
              })
          if (confirm(msg)) {
            try {
              const r = await api.triggerUpdate(target, {
                mode: updateMode,
                commit: updateMode === 'commit',
                allowDowngrade: true,
                allowRisk: true,
                idemKey: `update-dl-${target}-${Date.now()}`,
              })
              setToast({
                kind: 'ok',
                text: format(u.updaterDispatched, { jobId: r.job_id }),
              })
              await refresh()
              return
            } catch (e2) {
              setToast({ kind: 'error', text: explain(e2) })
              return
            }
          }
        }
        setToast({ kind: 'error', text: explain(e) })
      } finally {
        setBusy(null)
      }
    },
    [
      api,
      available,
      status,
      refresh,
      tokenRequired,
      explain,
      u,
      draftUpdateMode,
      draftChannel,
      commitInput,
      selectedRelease,
      comparePreview,
    ],
  )

  const triggerSelfUpdate = useCallback(async () => {
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    const target = status?.latest_available?.version ?? ''
    if (!target) return
    if (!confirm(format(u.updaterSelfUpdateConfirm, { version: target })))
      return
    setBusy('self-update')
    setToast(null)
    try {
      const r = await api.triggerSelfUpdate()
      setToast({
        kind: 'ok',
        text: format(u.updaterSelfUpdateDispatched, {
          helper: r.helper_container_id.slice(0, 12),
        }),
      })
    } catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    } finally {
      setBusy(null)
    }
  }, [api, status, tokenRequired, explain, u])

  const rollbackTo = useCallback(
    async (snapshotId: string) => {
      if (tokenRequired) {
        setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
        return
      }
      if (!confirm(format(u.updaterConfirmRollback, { snapshotId }))) return
      setBusy(`rollback-${snapshotId}`)
      try {
        await api.rollback(snapshotId)
        setToast({ kind: 'ok', text: u.updaterRollbackDispatched })
        await refresh()
      } catch (e) {
        setToast({ kind: 'error', text: explain(e) })
      } finally {
        setBusy(null)
      }
    },
    [api, refresh, tokenRequired, explain, u],
  )

  const exitMaintenance = useCallback(async () => {
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    if (!confirm(u.updaterConfirmExitMaintenance)) return
    setBusy('exit-maintenance')
    try {
      await api.exitMaintenance()
      setToast({ kind: 'ok', text: u.updaterMaintenanceExited })
      await refresh()
    } catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    } finally {
      setBusy(null)
    }
  }, [api, refresh, tokenRequired, explain, u])

  const rescueContinue = useCallback(async () => {
    if (tokenRequired) {
      setToast({ kind: 'error', text: u.updaterTokenRequiredDirect })
      return
    }
    const snap = status?.rescue_snapshot_id
    if (!snap) {
      setToast({ kind: 'error', text: u.updaterStatusNeedsManualDesc })
      return
    }
    if (
      !confirm(
        format(u.updaterConfirmRescueContinue, {
          snapshotId: snap,
          version: status?.rescue_source_version ?? '—',
        }),
      )
    ) {
      return
    }
    setBusy('rescue-continue')
    try {
      const res = await api.rescueContinue()
      setToast({
        kind: 'ok',
        text: `${u.updaterRescueContinueDispatched} · ${res.job_id.slice(0, 8)}`,
      })
      await refresh()
    } catch (e) {
      setToast({ kind: 'error', text: explain(e) })
    } finally {
      setBusy(null)
    }
  }, [api, refresh, tokenRequired, explain, u, status])

  const mood = useMemo<Mood>(() => deriveMood(status), [status])

  // 非 admin：整段折叠
  if (accessDenied && mode === 'backend') return null

  // ===== Render =====

  const showProgress =
    !!activeJob && !['succeeded', 'failed'].includes(activeJob.status)
  const showMaintenanceActions = !!status?.maintenance_active && !showProgress
  const showSelfUpdate =
    !!status?.requires_self_update && !!status.latest_available

  const statusValue = renderStatusValue(mood, status, u)

  return (
    <div className="updater-panel">
      {heading && <h3 className="updater-panel-heading">{heading}</h3>}

      {drift && (
        <div className="updater-drift">
          {format(u.updaterDriftWarn, drift)}{' '}
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

      {/* 进行中 → 进度卡占据主区；否则展示信息列表 */}
      {showProgress ? (
        <ProgressCard job={activeJob!} u={u} />
      ) : (
        <ul className="updater-list">
          <li className="updater-row">
            <span className="updater-row-label">{u.updaterCurrentVersion}</span>
            <span className="updater-row-value">
              {status?.current_version ? (
                <code>{status.current_version}</code>
              ) : (
                <span className="updater-row-value muted">
                  {status ? u.updaterStatusFirstRun : u.updaterUnknown}
                </span>
              )}
            </span>
          </li>
          <li className="updater-row">
            <span className="updater-row-label">{u.updaterRowStatus}</span>
            <span className={`updater-row-value ${statusValue.tone}`}>
              {statusValue.text}
            </span>
          </li>
          {status?.last_checked_at && (
            <li className="updater-row">
              <span className="updater-row-label">{u.updaterLastChecked}</span>
              <span className="updater-row-value muted">
                {formatAgo(status.last_checked_at, u)}
              </span>
            </li>
          )}
          <li className="updater-row updater-row-select">
            <span className="updater-row-label">{u.updaterUpdateMode}</span>
            <span className="updater-row-value">
              <select
                className="updater-select"
                value={draftUpdateMode}
                disabled={!!busy || tokenRequired}
                onChange={(e) => {
                  const m = e.target.value as UpdateMode
                  setDraftUpdateMode(m)
                  setDraftChannel(m === 'commit' ? 'main' : 'stable')
                  setAvailable(null)
                }}
              >
                <option value="release">{u.updaterModeRelease}</option>
                <option value="commit">{u.updaterModeCommit}</option>
              </select>
            </span>
          </li>
          <li className="updater-row updater-row-select">
            <span className="updater-row-label">{u.updaterChannel}</span>
            <span className="updater-row-value">
              <select
                className="updater-select"
                value={draftChannel}
                disabled={!!busy || tokenRequired}
                onChange={(e) => {
                  setDraftChannel(e.target.value)
                  setAvailable(null)
                }}
              >
                {channelOptions.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            </span>
          </li>
          {draftUpdateMode === 'commit' && (
            <li className="updater-row">
              <span className="updater-row-label">{u.updaterCommitTarget}</span>
              <span className="updater-row-value">
                <input
                  className="updater-input"
                  type="text"
                  placeholder={u.updaterCommitPlaceholder}
                  value={commitInput}
                  disabled={!!busy || tokenRequired}
                  onChange={(e) => setCommitInput(e.target.value)}
                />
              </span>
            </li>
          )}
        </ul>
      )}

      {comparePreview && !showProgress && (
        <div
          className={`updater-compare-preview ${
            comparePreview.is_downgrade
              ? 'downgrade'
              : comparePreview.is_upgrade
                ? 'upgrade'
                : 'neutral'
          }`}
        >
          {comparePreview.is_upgrade &&
            format(u.updaterFreshnessAhead, {
              n: String(comparePreview.ahead_by),
            })}
          {comparePreview.is_downgrade &&
            format(u.updaterFreshnessBehind, {
              n: String(comparePreview.behind_by),
            })}
          {!comparePreview.is_upgrade &&
            !comparePreview.is_downgrade &&
            comparePreview.relation === 'identical' &&
            u.updaterFreshnessIdentical}
          {!comparePreview.is_upgrade &&
            !comparePreview.is_downgrade &&
            comparePreview.relation === 'diverged' &&
            format(u.updaterFreshnessDiverged, {
              ahead: String(comparePreview.ahead_by),
              behind: String(comparePreview.behind_by),
            })}
          {!comparePreview.is_upgrade &&
            !comparePreview.is_downgrade &&
            comparePreview.relation === 'unknown' &&
            u.updaterFreshnessUnknown}
        </div>
      )}

      {draftUpdateMode === 'release' &&
        releaseList.length > 0 &&
        !showProgress && (
          <div className="updater-commit-list">
            <div className="updater-commit-list-head">
              {u.updaterReleaseHistory}
              {' · '}
              <code>{draftChannel}</code>
            </div>
            <ul>
              {releaseList.map((r) => (
                <li key={r.tag_name}>
                  <button
                    type="button"
                    className={
                      selectedRelease === r.tag_name ||
                      available?.version === r.tag_name
                        ? 'updater-commit-item selected'
                        : 'updater-commit-item'
                    }
                    disabled={!!busy || tokenRequired}
                    onClick={() => setSelectedRelease(r.tag_name)}
                  >
                    <code>{r.tag_name}</code>
                    <span className="updater-commit-msg">
                      {r.name || r.tag_name}
                      {r.prerelease ? ' (pre)' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

      {draftUpdateMode === 'commit' && commitList.length > 0 && !showProgress && (
        <div className="updater-commit-list">
          <div className="updater-commit-list-head">
            {u.updaterCommitHistory}
            {commitListBranch ? (
              <>
                {' '}
                · <code>{commitListBranch}</code>
              </>
            ) : null}
          </div>
          <ul>
            {commitList.map((c) => (
              <li key={c.sha}>
                <button
                  type="button"
                  className={
                    commitInput === c.tag || commitInput === c.short_sha
                      ? 'updater-commit-item selected'
                      : 'updater-commit-item'
                  }
                  disabled={!!busy || tokenRequired}
                  onClick={() => setCommitInput(c.tag)}
                  title={c.sha}
                >
                  <code>{c.short_sha}</code>
                  <span className="updater-commit-msg">{c.message}</span>
                  {c.committed_at && (
                    <span className="updater-commit-date">
                      {new Date(c.committed_at).toLocaleString()}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && (
        <div className={`updater-toast ${toast.kind}`}>{toast.text}</div>
      )}

      {/* 主操作行：根据 mood 选择文案 */}
      {!showProgress && (
        <div className="updater-actions">
          {(mood === 'available' ||
            mood === 'downgrade' ||
            (draftUpdateMode === 'commit' && commitInput.trim())) && (
            <button
              type="button"
              className={
                mood === 'downgrade'
                  ? 'btn-base btn-secondary'
                  : 'btn-base btn-primary'
              }
              onClick={() =>
                triggerUpgrade({ forceDowngrade: mood === 'downgrade' })
              }
              disabled={busy === 'upgrade' || tokenRequired}
            >
              <span>
                {busy === 'upgrade'
                  ? u.updaterDispatching
                  : mood === 'downgrade'
                    ? format(u.updaterDowngradeTo, {
                        version:
                          commitInput.trim() ||
                          available?.version ||
                          status?.latest_available?.version ||
                          '…',
                      })
                    : format(u.updaterUpgradeTo, {
                        version:
                          commitInput.trim() ||
                          available?.version ||
                          status?.latest_available?.version ||
                          '…',
                      })}
              </span>
            </button>
          )}
          <button
            type="button"
            className={
              mood === 'available'
                ? 'btn-base btn-secondary'
                : 'btn-base btn-primary'
            }
            onClick={checkAvailable}
            disabled={busy === 'check' || loading || tokenRequired}
          >
            <LuRefreshCw size={13} />
            <span>
              {busy === 'check' ? u.updaterChecking : u.updaterCheckAvailable}
            </span>
          </button>
          <button
            type="button"
            className="btn-base btn-secondary"
            onClick={applyPrefs}
            disabled={busy === 'prefs' || tokenRequired}
            title={u.updaterApplyPrefs}
          >
            <span>
              {busy === 'prefs' ? u.updaterProcessing : u.updaterApplyPrefs}
            </span>
          </button>
          {loading && !status && (
            <span className="updater-actions-hint">{u.updaterLoading}</span>
          )}
        </div>
      )}

      {/* ===== 维护操作（条件渲染，默认隐藏）===== */}
      {(showMaintenanceActions || showSelfUpdate) && (
        <SettingGroup
          title={u.updaterMaintenanceActions}
          collapsible
          defaultExpanded={mood === 'needsManual' || mood === 'maintenance'}
        >
          {showSelfUpdate && (
            <ButtonItem
              itemKey="self_update"
              label={u.updaterSelfUpdateButton}
              description={u.updaterActionSelfUpdateDesc}
              buttonText={
                busy === 'self-update'
                  ? u.updaterSelfUpdateDispatching
                  : u.updaterSelfUpdateButton
              }
              onClick={triggerSelfUpdate}
              variant="secondary"
              layout="horizontal"
              disabled={busy === 'self-update' || tokenRequired}
            />
          )}
          {showMaintenanceActions && mood === 'needsManual' && status?.rescue_snapshot_id && (
            <ButtonItem
              itemKey="rescue_continue"
              label={u.updaterRescueContinue}
              description={
                status.rescue_source_version
                  ? `${u.updaterRescueContinueDesc} · ${status.rescue_source_version}`
                  : u.updaterRescueContinueDesc
              }
              buttonText={
                busy === 'rescue-continue'
                  ? u.updaterProcessing
                  : u.updaterRescueContinue
              }
              onClick={rescueContinue}
              variant="primary"
              layout="horizontal"
              disabled={busy === 'rescue-continue' || tokenRequired}
            />
          )}
          {showMaintenanceActions && (
            <ButtonItem
              itemKey="exit_maintenance"
              label={u.updaterForceExit}
              description={u.updaterActionExitDesc}
              buttonText={
                busy === 'exit-maintenance'
                  ? u.updaterProcessing
                  : u.updaterForceExit
              }
              onClick={exitMaintenance}
              variant="danger"
              layout="horizontal"
              disabled={busy === 'exit-maintenance' || tokenRequired}
            />
          )}
        </SettingGroup>
      )}

      {/* ===== 快照与历史（折叠）===== */}
      <SettingGroup
        title={u.updaterGroupHistory}
        description={u.updaterGroupHistoryDesc}
        collapsible
        defaultExpanded={false}
      >
        {snapshots.length === 0 ? (
          <p className="updater-empty">{u.updaterNoSnapshots}</p>
        ) : (
          <div className="updater-snapshot-list">
            {snapshots.map((s) => (
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

      {/* ===== 高级（折叠）===== */}
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
          u={u}
          onModeChange={(m) => {
            setMode(m)
            if (m === 'backend') setToken('')
          }}
          onTokenChange={setToken}
          onRefresh={refresh}
        />
      </SettingGroup>
    </div>
  )
}

// ===== 状态推导 =====

function deriveMood(status: UpdaterStatus | null): Mood {
  if (!status) return 'offline'
  if (status.job_in_flight) return 'updating'
  if (status.maintenance_phase === 'needs_manual') return 'needsManual'
  if (status.maintenance_active) return 'maintenance'
  if (!status.current_version) return 'firstRun'
  if (status.update_available) return 'available'
  if (status.downgrade_available) return 'downgrade'
  return 'healthy'
}

function formatFreshness(
  la: NonNullable<UpdaterStatus['latest_available']>,
  u: ReturnType<typeof useI18n>['t']['config'],
): string | null {
  if (la.mode !== 'commit' && !la.relation) return null
  const rel = la.relation
  if (!rel) return null
  switch (rel) {
    case 'ahead':
      return format(u.updaterFreshnessAhead, {
        n: String(la.ahead_by ?? 0),
      })
    case 'behind':
      return format(u.updaterFreshnessBehind, {
        n: String(la.behind_by ?? 0),
      })
    case 'identical':
      return u.updaterFreshnessIdentical
    case 'diverged':
      return format(u.updaterFreshnessDiverged, {
        ahead: String(la.ahead_by ?? 0),
        behind: String(la.behind_by ?? 0),
      })
    case 'unknown':
      return u.updaterFreshnessUnknown
    default:
      return null
  }
}

function renderStatusValue(
  mood: Mood,
  status: UpdaterStatus | null,
  u: ReturnType<typeof useI18n>['t']['config'],
): {
  text: React.ReactNode
  tone: '' | 'muted' | 'attention' | 'warning' | 'danger'
} {
  const freshness = status?.latest_available
    ? formatFreshness(status.latest_available, u)
    : null
  switch (mood) {
    case 'healthy':
      return {
        text: (
          <>
            {u.updaterStatusHealthy}
            {freshness && (
              <>
                {' '}
                · <span className="muted">{freshness}</span>
              </>
            )}
          </>
        ),
        tone: 'muted',
      }
    case 'available':
      return {
        text: (
          <>
            {u.updaterStatusAvailable}
            {status?.latest_available && (
              <>
                {' '}
                · <code>{status.latest_available.version}</code>
              </>
            )}
            {freshness && (
              <>
                {' '}
                · <span className="muted">{freshness}</span>
              </>
            )}
          </>
        ),
        tone: 'attention',
      }
    case 'downgrade':
      return {
        text: (
          <>
            {u.updaterStatusDowngrade}
            {status?.latest_available && (
              <>
                {' '}
                · <code>{status.latest_available.version}</code>
              </>
            )}
            {freshness && (
              <>
                {' '}
                · <span className="muted">{freshness}</span>
              </>
            )}
          </>
        ),
        tone: 'warning',
      }
    case 'updating':
      return { text: u.updaterStatusUpdating, tone: 'warning' }
    case 'maintenance':
      return { text: u.updaterStatusMaintenance, tone: 'warning' }
    case 'needsManual':
      return { text: u.updaterStatusNeedsManual, tone: 'danger' }
    case 'offline':
      return { text: u.updaterStatusOffline, tone: 'danger' }
    case 'firstRun':
      return { text: u.updaterStatusFirstRunDesc, tone: 'muted' }
  }
}

// ===== 进度卡 =====

function ProgressCard({
  job,
  u,
}: {
  job: Job
  u: ReturnType<typeof useI18n>['t']['config']
}) {
  const done = job.steps.filter((s) => s.ok === true).length
  const total = Math.max(job.steps.length, done + 1)
  const pct = Math.min(99, Math.round((done / total) * 100))
  const currentStep = job.steps.at(-1)
  return (
    <div className="updater-progress">
      <div className="updater-progress-head">
        <h4 className="updater-progress-title">
          {u.updaterStatusUpdating}
          {job.to_version && (
            <>
              {' '}
              ·<code>{job.to_version}</code>
            </>
          )}
        </h4>
        <span className="updater-progress-counts">
          {done} /{total}
        </span>
      </div>
      <p className="updater-progress-phase">
        {currentStep?.phase ?? job.status}
      </p>
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
              <span
                className={
                  s.ok === true
                    ? 'updater-step-ok'
                    : s.ok === false
                      ? 'updater-step-err'
                      : ''
                }
              >
                <code>{s.phase}</code>
              </span>
              {s.error && (
                <span className="updater-step-err-msg">{s.error}</span>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

// ===== 快照行 =====

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
          {snapshot.source_version ? (
            <code>{snapshot.source_version}</code>
          ) : (
            <span className="updater-row-value muted">—</span>
          )}
        </div>
        <div className="updater-snapshot-info">
          {new Date(snapshot.created_at).toLocaleString()} ·
          {formatBytes(snapshot.size_bytes)}
        </div>
      </div>
      <button
        type="button"
        className="btn-base btn-secondary"
        onClick={onRollback}
        disabled={busy || disabled}
      >
        {u.updaterRollback}
      </button>
    </div>
  )
}

// ===== 高级面板 =====

function AdvancedPanel({
  status,
  available,
  mode,
  token,
  loading,
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
  u: ReturnType<typeof useI18n>['t']['config']
  onModeChange: (m: TransportMode) => void
  onTokenChange: (s: string) => void
  onRefresh: () => void
}) {
  return (
    <>
      <dl className="updater-detail-grid">
        <dt>{u.updaterUpdaterVersion}</dt>
        <dd>{status?.updater_version ?? '—'}</dd>
        <dt>{u.updaterChannel}</dt>
        <dd>{status?.channel ?? '—'}</dd>
        <dt>{u.updaterTransport}</dt>
        <dd>
          {mode === 'backend'
            ? u.updaterTransportBackend
            : u.updaterTransportDirect}
        </dd>
        <dt>{u.updaterJobInFlight}</dt>
        <dd>{status?.job_in_flight ?? u.updaterNone}</dd>
      </dl>

      {available && (
        <details style={{ marginTop: '0.6rem' }}>
          <summary
            style={{ cursor: 'pointer', fontSize: '0.82rem', color: '#6b7280' }}
          >
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
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="UPDATE_TOKEN"
          className="updater-token-input"
          autoComplete="off"
        />
      )}

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

// ===== 辅助 =====

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function formatAgo(
  iso: string,
  u: ReturnType<typeof useI18n>['t']['config'],
): string {
  const then = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (diffSec < 45) return u.updaterAgoJustNow
  const min = Math.round(diffSec / 60)
  if (min < 60) return format(u.updaterAgoMin, { n: String(min) })
  const hr = Math.round(min / 60)
  if (hr < 24) return format(u.updaterAgoHour, { n: String(hr) })
  const d = Math.round(hr / 24)
  return format(u.updaterAgoDay, { n: String(d) })
}

export default UpdaterInlinePanel
