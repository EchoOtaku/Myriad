/**
 * 联邦页面 — 时间线、关注管理、内容发布
 */

import type {
  ChannelListResponse,
  ChannelSummary,
  FederationTab,
  FollowListResponse,
  PublishedItem,
  PublishedListResponse,
  RemoteActor,
  RingListResponse,
  RingSummary,
  RoomListResponse,
  RoomSummary,
  TimelineItem,
  TimelineResponse,
} from '../types/federation'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AnimatedView from '../components/AnimatedView'
import { useI18n } from '../contexts/I18nContext'
import { federationApi } from '../services/federationApi'

// ==================== 子组件 ====================

function TabButton({ active, label, count, onClick }: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-accent/20 text-accent border border-accent/30'
          : 'text-secondary hover:text-primary hover:bg-card-bg'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-1.5 text-xs opacity-70">
          (
          {count}
          )
        </span>
      )}
    </button>
  )
}

function ActorCard({ actor, onUnfollow }: {
  actor: RemoteActor
  onUnfollow?: (actorUrl: string) => void
}) {
  const displayName = actor.display_name || actor.username || '?'
  const handle = actor.username ? `@${actor.username}@${actor.domain}` : actor.domain

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-card-bg/50 border border-border/30">
      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold shrink-0">
        {actor.avatar_url
          ? <img src={actor.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
          : displayName[0]?.toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-primary truncate">{displayName}</div>
        <div className="text-xs text-secondary truncate">{handle}</div>
      </div>
      {actor.status && (
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          actor.status === 'accepted' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
        }`}
        >
          {actor.status}
        </span>
      )}
      {onUnfollow && (
        <button
          type="button"
          onClick={() => onUnfollow(actor.actor_url)}
          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
        >
          取消关注
        </button>
      )}
    </div>
  )
}

function TimelineCard({ item }: { item: TimelineItem }) {
  const actorName = item.actor.display_name || item.actor.username || '?'
  const handle = item.actor.username
    ? `@${item.actor.username}@${item.actor.domain || ''}`
    : item.actor.domain || ''

  return (
    <div className={`p-4 rounded-lg border transition-colors ${
      item.is_read ? 'bg-card-bg/30 border-border/20' : 'bg-card-bg/50 border-accent/20'
    }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">
          {item.actor.avatar_url
            ? <img src={item.actor.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
            : actorName[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-medium text-primary text-sm">{actorName}</span>
          <span className="text-xs text-secondary ml-1.5">{handle}</span>
        </div>
        <span className="text-xs text-secondary bg-card-bg px-2 py-0.5 rounded">
          {item.activity_type || 'Activity'}
        </span>
      </div>
      {item.content_preview && (
        <p className="text-sm text-secondary line-clamp-3">{item.content_preview}</p>
      )}
    </div>
  )
}

function PublishedCard({ item, onUnpublish }: {
  item: PublishedItem
  onUnpublish: (contentType: string, contentId: string) => void
}) {
  const typeLabel: Record<string, string> = {
    'report': '📊 报告',
    'brew-article': '📰 文章',
    'library': '📚 资料',
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-card-bg/50 border border-border/30">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-primary">
            {typeLabel[item.content_type] || item.content_type}
          </span>
          <span className="text-xs text-secondary">
            #
            {item.content_id}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            item.visibility === 'public' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
          }`}
          >
            {item.visibility}
          </span>
        </div>
        <div className="text-xs text-secondary mt-1">
          {new Date(item.published_at).toLocaleString()}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onUnpublish(item.content_type, item.content_id)}
        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
      >
        取消发布
      </button>
    </div>
  )
}

function ChannelCard({ channel, onOpen, onAccept, onClose }: {
  channel: ChannelSummary
  onOpen: () => void
  onAccept?: () => void
  onClose?: () => void
}) {
  const displayName = channel.remote_actor_name || channel.remote_actor_url.split('/').pop() || '?'
  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    accepted: 'bg-blue-500/20 text-blue-400',
    active: 'bg-green-500/20 text-green-400',
    closed: 'bg-gray-500/20 text-gray-400',
    rejected: 'bg-red-500/20 text-red-400',
  }

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg bg-card-bg/50 border border-border/30 cursor-pointer hover:bg-card-bg/80 transition-colors"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onOpen()}
    >
      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold shrink-0">
        💬
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-primary truncate">{displayName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor[channel.status] || 'bg-gray-500/20 text-gray-400'}`}>
            {channel.status}
          </span>
          {channel.unread_count > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {channel.unread_count}
            </span>
          )}
        </div>
        <div className="text-xs text-secondary mt-0.5">
          {channel.channel_type}
          {' '}
          ·
          {channel.transport}
          {channel.last_activity_at && ` · ${new Date(channel.last_activity_at).toLocaleString()}`}
        </div>
      </div>
      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
        {onAccept && (
          <button
            type="button"
            onClick={onAccept}
            className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded hover:bg-green-500/10 transition-colors"
          >
            接受
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
          >
            关闭
          </button>
        )}
      </div>
    </div>
  )
}

// ==================== RoomCard ====================

function RoomCard({ room, onOpen, onLeave }: {
  room: RoomSummary
  onOpen: () => void
  onLeave?: () => void
}) {
  const roleColor: Record<string, string> = {
    owner: 'bg-yellow-500/20 text-yellow-400',
    admin: 'bg-purple-500/20 text-purple-400',
    member: 'bg-blue-500/20 text-blue-400',
    observer: 'bg-gray-500/20 text-gray-400',
  }
  const govIcon: Record<string, string> = {
    owner_only: '👑',
    admin_approve: '🛡️',
    open: '🌐',
  }

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg bg-card-bg/50 border border-border/30 cursor-pointer hover:bg-card-bg/80 transition-colors"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onOpen()}
    >
      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent text-lg shrink-0">
        {govIcon[room.governance_type] || '🏠'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-primary truncate">{room.name}</span>
          {room.my_role && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${roleColor[room.my_role] || 'bg-gray-500/20 text-gray-400'}`}>
              {room.my_role}
            </span>
          )}
          {room.unread_count > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {room.unread_count}
            </span>
          )}
        </div>
        <div className="text-xs text-secondary mt-0.5">
          👥
          {' '}
          {room.member_count}
          {' · '}
          {room.governance_type}
          {room.last_message_at && ` · ${new Date(room.last_message_at).toLocaleString()}`}
        </div>
      </div>
      {onLeave && (
        <div onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={onLeave}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
          >
            退出
          </button>
        </div>
      )}
    </div>
  )
}

// ==================== RingCard ====================

function RingCard({ ring, onOpen, onLeave }: {
  ring: RingSummary
  onOpen: () => void
  onLeave: () => void
}) {
  const typeIcon: Record<string, string> = {
    'tapp-store': '🧩',
    'brew-recommend': '☕',
    'library-exchange': '📚',
    'instance-directory': '🌐',
  }

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg bg-card-bg/50 border border-border/30 cursor-pointer hover:bg-card-bg/80 transition-colors"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onOpen()}
    >
      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent text-lg shrink-0">
        {typeIcon[ring.ring_type] || '🔗'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-primary truncate">{ring.ring_name || ring.ring_id}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">
            {ring.ring_type}
          </span>
        </div>
        <div className="text-xs text-secondary mt-0.5">
          🔗
          {' '}
          {ring.peer_count}
          {' peers'}
          {ring.last_sync_at && ` · ${new Date(ring.last_sync_at).toLocaleString()}`}
        </div>
      </div>
      <div onClick={e => e.stopPropagation()}>
        <button
          type="button"
          onClick={onLeave}
          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
        >
          退出
        </button>
      </div>
    </div>
  )
}

// ==================== 主页面 ====================

export default function Federation() {
  const { t } = useI18n()
  const [tab, setTab] = useState<FederationTab>('timeline')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 数据状态
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [following, setFollowing] = useState<RemoteActor[]>([])
  const [followers, setFollowers] = useState<RemoteActor[]>([])
  const [published, setPublished] = useState<PublishedItem[]>([])
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [rings, setRings] = useState<RingSummary[]>([])

  // 关注输入
  const [followTarget, setFollowTarget] = useState('')
  const [followLoading, setFollowLoading] = useState(false)

  // Channel 创建
  const [channelTarget, setChannelTarget] = useState('')
  const [channelLoading, setChannelLoading] = useState(false)

  // Room 创建
  const [roomName, setRoomName] = useState('')
  const [roomLoading, setRoomLoading] = useState(false)

  // Ring 创建
  const [ringName, setRingName] = useState('')
  const [ringType, setRingType] = useState('brew-recommend')
  const [ringLoading, setRingLoading] = useState(false)

  const navigate = useNavigate()

  // 计数
  const [counts, setCounts] = useState({ timeline: 0, following: 0, followers: 0, published: 0, channels: 0, rooms: 0, rings: 0 })

  const fedT = t.federation

  const loadData = useCallback(async (currentTab: FederationTab) => {
    setLoading(true)
    setError(null)
    try {
      switch (currentTab) {
        case 'timeline': {
          const res: TimelineResponse = await federationApi.getTimeline()
          setTimeline(res.items)
          setCounts(prev => ({ ...prev, timeline: res.total }))
          break
        }
        case 'following': {
          const res: FollowListResponse = await federationApi.getFollowing()
          setFollowing(res.items)
          setCounts(prev => ({ ...prev, following: res.total }))
          break
        }
        case 'followers': {
          const res: FollowListResponse = await federationApi.getFollowers()
          setFollowers(res.items)
          setCounts(prev => ({ ...prev, followers: res.total }))
          break
        }
        case 'published': {
          const res: PublishedListResponse = await federationApi.getPublished()
          setPublished(res.items)
          setCounts(prev => ({ ...prev, published: res.total }))
          break
        }
        case 'channels': {
          const res: ChannelListResponse = await federationApi.getChannels()
          setChannels(res.channels)
          setCounts(prev => ({ ...prev, channels: res.total }))
          break
        }
        case 'rooms': {
          const res: RoomListResponse = await federationApi.getRooms()
          setRooms(res.rooms)
          setCounts(prev => ({ ...prev, rooms: res.total }))
          break
        }
        case 'rings': {
          const res: RingListResponse = await federationApi.getRings()
          setRings(res.rings)
          setCounts(prev => ({ ...prev, rings: res.total }))
          break
        }
      }
    }
    catch (err: any) {
      setError(err.message || 'Failed to load data')
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(tab)
  }, [tab, loadData])

  const handleFollow = async () => {
    if (!followTarget.trim())
      return
    setFollowLoading(true)
    try {
      await federationApi.follow(followTarget.trim())
      setFollowTarget('')
      loadData('following')
    }
    catch (err: any) {
      setError(err.message || 'Follow failed')
    }
    finally {
      setFollowLoading(false)
    }
  }

  const handleUnfollow = async (actorUrl: string) => {
    try {
      await federationApi.unfollow(actorUrl)
      loadData('following')
    }
    catch (err: any) {
      setError(err.message || 'Unfollow failed')
    }
  }

  const handleUnpublish = async (contentType: string, contentId: string) => {
    try {
      await federationApi.unpublish({ content_type: contentType, content_id: contentId })
      loadData('published')
    }
    catch (err: any) {
      setError(err.message || 'Unpublish failed')
    }
  }

  const handleCreateChannel = async () => {
    if (!channelTarget.trim())
      return
    setChannelLoading(true)
    try {
      const detail = await federationApi.createChannel({ remote_actor: channelTarget.trim() })
      setChannelTarget('')
      navigate(`/federation/chat/${detail.channel_id}`)
    }
    catch (err: any) {
      setError(err.message || 'Failed to create channel')
    }
    finally {
      setChannelLoading(false)
    }
  }

  const handleAcceptChannel = async (channelId: string) => {
    try {
      await federationApi.acceptChannel(channelId)
      loadData('channels')
    }
    catch (err: any) {
      setError(err.message || 'Accept failed')
    }
  }

  const handleCloseChannel = async (channelId: string) => {
    try {
      await federationApi.closeChannel(channelId)
      loadData('channels')
    }
    catch (err: any) {
      setError(err.message || 'Close failed')
    }
  }

  // Room 操作
  const handleCreateRoom = async () => {
    if (!roomName.trim())
      return
    setRoomLoading(true)
    try {
      const detail = await federationApi.createRoom({ name: roomName.trim() })
      setRoomName('')
      navigate(`/federation/room/${detail.room_id}`)
    }
    catch (err: any) {
      setError(err.message || 'Failed to create room')
    }
    finally {
      setRoomLoading(false)
    }
  }

  const handleLeaveRoom = async (roomId: string) => {
    try {
      await federationApi.leaveRoom(roomId)
      loadData('rooms')
    }
    catch (err: any) {
      setError(err.message || 'Leave failed')
    }
  }

  const handleCreateRing = async () => {
    if (!ringName.trim())
      return
    setRingLoading(true)
    try {
      await federationApi.createRing({ name: ringName.trim(), ring_type: ringType })
      setRingName('')
      loadData('rings')
    }
    catch (err: any) {
      setError(err.message || 'Create ring failed')
    }
    finally {
      setRingLoading(false)
    }
  }

  const handleLeaveRing = async (ringId: string) => {
    try {
      await federationApi.leaveRing(ringId)
      loadData('rings')
    }
    catch (err: any) {
      setError(err.message || 'Leave failed')
    }
  }

  return (
    <AnimatedView className="min-h-screen px-3 xs:px-4 sm:px-6 pt-20 pb-28 sm:pb-24 md:pb-12">
      <div className="max-w-4xl mx-auto">
        {/* 标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary">
            {fedT.title || '联邦网络'}
          </h1>
          <p className="text-sm text-secondary mt-1">
            {fedT.subtitle || '连接去中心化社交网络，订阅远程用户动态'}
          </p>
        </div>

        {/* Tab 栏 */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <TabButton
            active={tab === 'timeline'}
            label={fedT.timeline || '时间线'}
            count={counts.timeline}
            onClick={() => setTab('timeline')}
          />
          <TabButton
            active={tab === 'following'}
            label={fedT.following || '关注'}
            count={counts.following}
            onClick={() => setTab('following')}
          />
          <TabButton
            active={tab === 'followers'}
            label={fedT.followers || '粉丝'}
            count={counts.followers}
            onClick={() => setTab('followers')}
          />
          <TabButton
            active={tab === 'published'}
            label={fedT.published || '已发布'}
            count={counts.published}
            onClick={() => setTab('published')}
          />
          <TabButton
            active={tab === 'channels'}
            label={fedT.channels || '通道'}
            count={counts.channels}
            onClick={() => setTab('channels')}
          />
          <TabButton
            active={tab === 'rooms'}
            label={fedT.rooms || '房间'}
            count={counts.rooms}
            onClick={() => setTab('rooms')}
          />
          <TabButton
            active={tab === 'rings'}
            label={fedT.rings || '环网'}
            count={counts.rings}
            onClick={() => setTab('rings')}
          />
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
            <button type="button" onClick={() => setError(null)} className="ml-2 underline">
              {t.common.close}
            </button>
          </div>
        )}

        {/* 内容区 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-secondary text-sm">{t.common.loading}</span>
          </div>
        ) : (
          <>
            {/* 时间线 */}
            {tab === 'timeline' && (
              <div className="space-y-3">
                {timeline.length === 0 ? (
                  <div className="text-center py-16 text-secondary">
                    <div className="text-4xl mb-3">🌐</div>
                    <p>{fedT.emptyTimeline || '时间线为空'}</p>
                    <p className="text-xs mt-1 opacity-60">
                      {fedT.emptyTimelineHint || '关注远程用户后，他们的动态将显示在这里'}
                    </p>
                  </div>
                ) : (
                  timeline.map(item => (
                    <TimelineCard key={item.activity_id} item={item} />
                  ))
                )}
              </div>
            )}

            {/* 关注列表 */}
            {tab === 'following' && (
              <div>
                {/* 关注输入 */}
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={followTarget}
                    onChange={e => setFollowTarget(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFollow()}
                    placeholder={fedT.followPlaceholder || 'user@instance.social 或 Actor URL'}
                    className="flex-1 px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm placeholder:text-secondary/50 focus:outline-none focus:border-accent/50"
                  />
                  <button
                    type="button"
                    onClick={handleFollow}
                    disabled={followLoading || !followTarget.trim()}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {followLoading ? '...' : (fedT.followBtn || '关注')}
                  </button>
                </div>
                <div className="space-y-2">
                  {following.length === 0 ? (
                    <div className="text-center py-12 text-secondary">
                      <div className="text-3xl mb-2">👥</div>
                      <p>{fedT.emptyFollowing || '还没有关注任何远程用户'}</p>
                    </div>
                  ) : (
                    following.map((actor, i) => (
                      <ActorCard key={actor.actor_url || i} actor={actor} onUnfollow={handleUnfollow} />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 粉丝列表 */}
            {tab === 'followers' && (
              <div className="space-y-2">
                {followers.length === 0 ? (
                  <div className="text-center py-12 text-secondary">
                    <div className="text-3xl mb-2">🌟</div>
                    <p>{fedT.emptyFollowers || '还没有远程粉丝'}</p>
                  </div>
                ) : (
                  followers.map((actor, i) => (
                    <ActorCard key={actor.actor_url || i} actor={actor} />
                  ))
                )}
              </div>
            )}

            {/* 已发布内容 */}
            {tab === 'published' && (
              <div className="space-y-2">
                {published.length === 0 ? (
                  <div className="text-center py-12 text-secondary">
                    <div className="text-3xl mb-2">📡</div>
                    <p>{fedT.emptyPublished || '还没有发布任何内容到联邦网络'}</p>
                    <p className="text-xs mt-1 opacity-60">
                      {fedT.emptyPublishedHint || '在报告或 Brew 文章中点击"发布到联邦"按钮'}
                    </p>
                  </div>
                ) : (
                  published.map(item => (
                    <PublishedCard key={item.id} item={item} onUnpublish={handleUnpublish} />
                  ))
                )}
              </div>
            )}

            {/* Channel 列表 */}
            {tab === 'channels' && (
              <div>
                {/* 创建 Channel */}
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={channelTarget}
                    onChange={e => setChannelTarget(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateChannel()}
                    placeholder={fedT.channelPlaceholder || '远程 Actor URL 或 user@domain'}
                    className="flex-1 px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm placeholder:text-secondary/50 focus:outline-none focus:border-accent/50"
                  />
                  <button
                    type="button"
                    onClick={handleCreateChannel}
                    disabled={channelLoading || !channelTarget.trim()}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {channelLoading ? '...' : (fedT.newChannelBtn || '新建通道')}
                  </button>
                </div>
                <div className="space-y-2">
                  {channels.length === 0 ? (
                    <div className="text-center py-12 text-secondary">
                      <div className="text-3xl mb-2">💬</div>
                      <p>{fedT.emptyChannels || '还没有任何通道'}</p>
                      <p className="text-xs mt-1 opacity-60">
                        {fedT.emptyChannelsHint || '创建通道开始与远程用户实时通信'}
                      </p>
                    </div>
                  ) : (
                    channels.map(ch => (
                      <ChannelCard
                        key={ch.channel_id}
                        channel={ch}
                        onOpen={() => navigate(`/federation/chat/${ch.channel_id}`)}
                        onAccept={ch.status === 'pending' && ch.initiated_by === 'remote' ? () => handleAcceptChannel(ch.channel_id) : undefined}
                        onClose={ch.status !== 'closed' ? () => handleCloseChannel(ch.channel_id) : undefined}
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Room 列表 */}
            {tab === 'rooms' && (
              <div>
                {/* 创建 Room */}
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={roomName}
                    onChange={e => setRoomName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateRoom()}
                    placeholder={fedT.roomNamePlaceholder || '房间名称'}
                    className="flex-1 px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm placeholder:text-secondary/50 focus:outline-none focus:border-accent/50"
                  />
                  <button
                    type="button"
                    onClick={handleCreateRoom}
                    disabled={roomLoading || !roomName.trim()}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {roomLoading ? '...' : (fedT.newRoomBtn || '新建房间')}
                  </button>
                </div>
                <div className="space-y-2">
                  {rooms.length === 0 ? (
                    <div className="text-center py-12 text-secondary">
                      <div className="text-3xl mb-2">🏠</div>
                      <p>{fedT.emptyRooms || '还没有加入任何房间'}</p>
                      <p className="text-xs mt-1 opacity-60">
                        {fedT.emptyRoomsHint || '创建房间开始多人群聊协作'}
                      </p>
                    </div>
                  ) : (
                    rooms.map(rm => (
                      <RoomCard
                        key={rm.room_id}
                        room={rm}
                        onOpen={() => navigate(`/federation/room/${rm.room_id}`)}
                        onLeave={rm.my_role !== 'owner' ? () => handleLeaveRoom(rm.room_id) : undefined}
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Ring 列表 */}
            {tab === 'rings' && (
              <div>
                {/* 创建 Ring */}
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={ringName}
                    onChange={e => setRingName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateRing()}
                    placeholder={fedT.ringNamePlaceholder || 'Ring 名称'}
                    className="flex-1 px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm placeholder:text-secondary/50 focus:outline-none focus:border-accent/50"
                  />
                  <select
                    value={ringType}
                    onChange={e => setRingType(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm focus:outline-none focus:border-accent/50"
                  >
                    <option value="brew-recommend">☕ Brew</option>
                    <option value="tapp-store">🧩 Tapp</option>
                    <option value="library-exchange">📚 Library</option>
                    <option value="instance-directory">🌐 Instance</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleCreateRing}
                    disabled={ringLoading || !ringName.trim()}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {ringLoading ? '...' : (fedT.newRingBtn || '新建环网')}
                  </button>
                </div>
                <div className="space-y-2">
                  {rings.length === 0 ? (
                    <div className="text-center py-12 text-secondary">
                      <div className="text-3xl mb-2">🔗</div>
                      <p>{fedT.emptyRings || '还没有加入任何环网'}</p>
                      <p className="text-xs mt-1 opacity-60">
                        {fedT.emptyRingsHint || '创建环网开始去中心化数据同步'}
                      </p>
                    </div>
                  ) : (
                    rings.map(ring => (
                      <RingCard
                        key={ring.ring_id}
                        ring={ring}
                        onOpen={() => navigate(`/federation/ring/${ring.ring_id}`)}
                        onLeave={() => handleLeaveRing(ring.ring_id)}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AnimatedView>
  )
}
