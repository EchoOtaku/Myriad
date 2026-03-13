/**
 * 联邦 Ring 详情页 — Peer 管理 + Gossip 同步
 */

import type { RingDetail, RingPeer } from '../types/federation'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AnimatedView from '../components/AnimatedView'
import { useI18n } from '../contexts/I18nContext'
import { federationApi } from '../services/federationApi'

export default function FederationRing() {
  const { ringId } = useParams<{ ringId: string }>()
  const navigate = useNavigate()
  const { t } = useI18n()
  const fedT = t.federation

  const [ring, setRing] = useState<RingDetail | null>(null)
  const [peers, setPeers] = useState<RingPeer[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [peerInput, setPeerInput] = useState('')
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const loadRing = useCallback(async () => {
    if (!ringId)
      return
    setLoading(true)
    try {
      const [detail, peersRes] = await Promise.all([
        federationApi.getRing(ringId),
        federationApi.getRingPeers(ringId),
      ])
      setRing(detail)
      setPeers(peersRes.peers)
    }
    catch {
      // ignore
    }
    finally {
      setLoading(false)
    }
  }, [ringId])

  useEffect(() => {
    loadRing()
  }, [loadRing])

  const handleAddPeer = async () => {
    if (!ringId || !peerInput.trim())
      return
    try {
      await federationApi.addPeer(ringId, { peer: peerInput.trim() })
      setPeerInput('')
      loadRing()
    }
    catch {
      // ignore
    }
  }

  const handleRemovePeer = async (peerUrl: string) => {
    if (!ringId)
      return
    try {
      await federationApi.removePeer(ringId, peerUrl)
      loadRing()
    }
    catch {
      // ignore
    }
  }

  const handleSync = async () => {
    if (!ringId)
      return
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await federationApi.triggerSync(ringId)
      setSyncResult(`${fedT.syncComplete || '同步完成'}: ${res.synced_peers} peers, ${res.entries_count} entries`)
    }
    catch {
      setSyncResult(fedT.syncFailed || '同步失败')
    }
    finally {
      setSyncing(false)
    }
  }

  const handleLeave = async () => {
    if (!ringId)
      return
    try {
      await federationApi.leaveRing(ringId)
      navigate('/federation')
    }
    catch {
      // ignore
    }
  }

  const typeIcon: Record<string, string> = {
    'tapp-store': '🧩',
    'brew-recommend': '☕',
    'library-exchange': '📚',
    'instance-directory': '🌐',
  }

  if (loading) {
    return (
      <AnimatedView>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      </AnimatedView>
    )
  }

  if (!ring) {
    return (
      <AnimatedView>
        <div className="text-center py-12 text-secondary">Ring not found</div>
      </AnimatedView>
    )
  }

  return (
    <AnimatedView>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* 头部 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/federation')}
            className="text-secondary hover:text-primary transition-colors"
          >
            ←
            {' '}
            {fedT.back}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{typeIcon[ring.ring_type] || '🔗'}</span>
              <h1 className="text-xl font-bold text-primary truncate">
                {ring.ring_name || ring.ring_id}
              </h1>
              <span className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent">
                {ring.ring_type}
              </span>
            </div>
            <div className="text-xs text-secondary mt-1">
              {ring.known_peers.length}
              {' '}
              peers
              {ring.last_sync_at && ` · ${fedT.lastSync || '上次同步'}: ${new Date(ring.last_sync_at).toLocaleString()}`}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLeave}
            className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded hover:bg-red-500/10 transition-colors"
          >
            {fedT.leaveRing}
          </button>
        </div>

        {/* Gossip 配置 */}
        {ring.gossip_config && (
          <div className="p-3 rounded-lg bg-card-bg/50 border border-border/30">
            <h3 className="text-sm font-medium text-primary mb-2">
              Gossip
              {fedT.config || '配置'}
            </h3>
            <div className="flex gap-4 text-xs text-secondary">
              <span>
                Fanout:
                {String(ring.gossip_config.fanout ?? 3)}
              </span>
              <span>
                TTL:
                {String(ring.gossip_config.ttl ?? 5)}
              </span>
              <span>
                Interval:
                {String(ring.gossip_config.interval ?? 300)}
                s
              </span>
            </div>
          </div>
        )}

        {/* 同步按钮 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || peers.length === 0}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {syncing ? '...' : (fedT.triggerSync || '触发同步')}
          </button>
          {syncResult && (
            <span className="text-xs text-secondary">{syncResult}</span>
          )}
        </div>

        {/* Peer 管理 */}
        <div>
          <h3 className="text-sm font-medium text-primary mb-3">{fedT.ringPeers || 'Peers'}</h3>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={peerInput}
              onChange={e => setPeerInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddPeer()}
              placeholder={fedT.addPeerPlaceholder || 'Actor URL 或 user@domain'}
              className="flex-1 px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm placeholder:text-secondary/50 focus:outline-none focus:border-accent/50"
            />
            <button
              type="button"
              onClick={handleAddPeer}
              disabled={!peerInput.trim()}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {fedT.addPeerBtn || '添加'}
            </button>
          </div>
          <div className="space-y-2">
            {peers.length === 0 ? (
              <div className="text-center py-8 text-secondary">
                <div className="text-2xl mb-2">🔗</div>
                <p>{fedT.emptyPeers || '暂无 Peer'}</p>
                <p className="text-xs mt-1 opacity-60">{fedT.emptyPeersHint || '添加远程实例 Peer 开始环网同步'}</p>
              </div>
            ) : (
              peers.map(peer => (
                <div
                  key={peer.actor_url}
                  className="flex items-center gap-3 p-3 rounded-lg bg-card-bg/50 border border-border/30"
                >
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm shrink-0">
                    🖥️
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-primary truncate">{peer.actor_url}</div>
                    <div className="text-xs text-secondary">{peer.instance_domain}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemovePeer(peer.actor_url)}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                  >
                    {fedT.removePeer || '移除'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AnimatedView>
  )
}
