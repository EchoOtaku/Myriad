/**
 * 联邦 API 服务
 */

import type {
  AddPeerRequest,
  ChannelDetail,
  ChannelListResponse,
  CreateChannelRequest,
  CreateRingRequest,
  CreateRoomRequest,
  FederationIdentity,
  FollowListResponse,
  FollowRequest,
  FollowResponse,
  InitTransferRequest,
  InstanceListResponse,
  InviteMemberRequest,
  MessageListResponse,
  PublishedListResponse,
  PublishRequest,
  PublishResponse,
  RingDetail,
  RingListResponse,
  RingPeersResponse,
  RoomDetail,
  RoomListResponse,
  RoomMembersResponse,
  RoomMessageListResponse,
  SendMessageRequest,
  SendMessageResponse,
  SendRoomMessageRequest,
  SendRoomMessageResponse,
  TimelineResponse,
  ToggleBlockRequest,
  TransferDetail,
  TransferListResponse,
  TrustPolicyResponse,
  UnpublishRequest,
  UpdateRoomRequest,
  UpdateTrustRequest,
  UploadChunkRequest,
} from '../types/federation'
import { apiService } from './api'
import { federationMock } from './federationMock'

const PREFIX = '/federation'

/**
 * 开发环境 mock 模式控制。
 * 默认在 dev 环境启用 mock，后端联邦可用时可通过 localStorage 关闭：
 *   localStorage.setItem('federation-real', '1')
 */
function shouldUseMock(): boolean {
  try {
    if (!import.meta.env.DEV) return false
    // 开发者可手动切换回真实 API
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('federation-real') === '1'
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function withDevFallback<T>(
  realCall: () => Promise<T>,
  mockCall: () => Promise<T>,
): Promise<T> {
  if (shouldUseMock()) return mockCall()
  return realCall()
}

function dispatchMockWsListener(
  listener: EventListenerOrEventListenerObject,
  event: Event,
): void {
  if (typeof listener === 'function') {
    listener(event)
  } else {
    listener.handleEvent(event)
  }
}

/**
 * Mock WebSocket — 模拟已连接状态，不发送/接收真实数据。
 * 通过 MessageChannel 创建一个合法的 WebSocket-like 对象。
 */
function createMockWs(): WebSocket {
  const _listeners: Record<string, EventListenerOrEventListenerObject | null> =
    {}
  let _readyState = 1 // OPEN

  const proxy = Object.create(new EventTarget(), {
    readyState: { get: () => _readyState },
    send: { value: () => {} },
    close: {
      value: () => {
        _readyState = 3
        if (_listeners.close)
          dispatchMockWsListener(_listeners.close, new CloseEvent('close'))
      },
    },
    onopen: {
      get: () => _listeners.open ?? null,
      set: (fn: any) => {
        _listeners.open = fn
      },
      configurable: true,
    },
    onmessage: {
      get: () => _listeners.message ?? null,
      set: (fn: any) => {
        _listeners.message = fn
      },
      configurable: true,
    },
    onclose: {
      get: () => _listeners.close ?? null,
      set: (fn: any) => {
        _listeners.close = fn
      },
      configurable: true,
    },
    onerror: {
      get: () => _listeners.error ?? null,
      set: (fn: any) => {
        _listeners.error = fn
      },
      configurable: true,
    },
    addEventListener: {
      value: (type: string, fn: any) => {
        _listeners[type] = fn
      },
    },
    removeEventListener: {
      value: (type: string, _fn: any) => {
        delete _listeners[type]
      },
    },
  }) as unknown as WebSocket

  setTimeout(() => {
    if (_listeners.open) {
      dispatchMockWsListener(_listeners.open, new Event('open'))
    }
  }, 30)

  return proxy
}

export const federationApi = {
  /** 获取当前用户联邦身份 */
  getIdentity(): Promise<FederationIdentity> {
    return withDevFallback(
      () => apiService.get<FederationIdentity>(`${PREFIX}/identity`),
      () => federationMock.getIdentity(),
    )
  },

  // ==================== 关注管理 ====================

  /** 关注远程用户 */
  follow(target: string): Promise<FollowResponse> {
    return apiService.post<FollowResponse>(`${PREFIX}/follow`, {
      target,
    } satisfies FollowRequest)
  },

  /** 取消关注 */
  unfollow(target: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/unfollow`, {
      target,
    } satisfies FollowRequest)
  },

  /** 获取我关注的远程用户 */
  getFollowing(): Promise<FollowListResponse> {
    return withDevFallback(
      () => apiService.get<FollowListResponse>(`${PREFIX}/following`),
      () => federationMock.getFollowing(),
    )
  },

  /** 获取关注我的远程用户 */
  getFollowers(): Promise<FollowListResponse> {
    return withDevFallback(
      () => apiService.get<FollowListResponse>(`${PREFIX}/followers`),
      () => federationMock.getFollowers(),
    )
  },

  // ==================== 时间线 ====================

  /** 获取联邦时间线 */
  getTimeline(): Promise<TimelineResponse> {
    return withDevFallback(
      () => apiService.get<TimelineResponse>(`${PREFIX}/timeline`),
      () => federationMock.getTimeline(),
    )
  },

  // ==================== 内容发布 ====================

  /** 发布内容到联邦网络 */
  publish(req: PublishRequest): Promise<PublishResponse> {
    return apiService.post<PublishResponse>(`${PREFIX}/publish`, req)
  },

  /** 取消发布 */
  unpublish(req: UnpublishRequest): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/unpublish`, req)
  },

  /** 获取已发布内容列表 */
  getPublished(): Promise<PublishedListResponse> {
    return withDevFallback(
      () => apiService.get<PublishedListResponse>(`${PREFIX}/published`),
      () => federationMock.getPublished(),
    )
  },

  // ==================== Channel 通信 ====================

  /** 获取 Channel 列表 */
  getChannels(): Promise<ChannelListResponse> {
    return withDevFallback(
      () => apiService.get<ChannelListResponse>(`${PREFIX}/channels`),
      () => federationMock.getChannels(),
    )
  },

  /** 创建 Channel */
  createChannel(req: CreateChannelRequest): Promise<ChannelDetail> {
    return withDevFallback(
      () => apiService.post<ChannelDetail>(`${PREFIX}/channels`, req),
      () => federationMock.createChannel(req) as Promise<ChannelDetail>,
    )
  },

  /** 获取 Channel 详情 */
  getChannel(channelId: string): Promise<ChannelDetail> {
    return withDevFallback(
      () => apiService.get<ChannelDetail>(`${PREFIX}/channels/${channelId}`),
      () => federationMock.getChannel(channelId),
    )
  },

  /** 关闭 Channel */
  closeChannel(channelId: string): Promise<{ success: boolean }> {
    return withDevFallback(
      () =>
        apiService.post<{ success: boolean }>(
          `${PREFIX}/channels/${channelId}/close`,
          {},
        ),
      () => federationMock.closeChannel(channelId),
    )
  },

  /** 接受 Channel */
  acceptChannel(channelId: string): Promise<{ success: boolean }> {
    return withDevFallback(
      () =>
        apiService.post<{ success: boolean }>(
          `${PREFIX}/channels/${channelId}/accept`,
          {},
        ),
      () => federationMock.acceptChannel(channelId),
    )
  },

  /** 获取消息历史 */
  getMessages(
    channelId: string,
    before?: string,
    limit?: number,
  ): Promise<MessageListResponse> {
    return withDevFallback(
      () => {
        const params = new URLSearchParams()
        if (before) params.set('before', before)
        if (limit) params.set('limit', String(limit))
        const qs = params.toString()
        return apiService.get<MessageListResponse>(
          `${PREFIX}/channels/${channelId}/messages${qs ? `?${qs}` : ''}`,
        )
      },
      () => federationMock.getMessages(channelId),
    )
  },

  /** 发送消息 */
  sendMessage(
    channelId: string,
    req: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    return withDevFallback(
      () =>
        apiService.post<SendMessageResponse>(
          `${PREFIX}/channels/${channelId}/messages`,
          req,
        ),
      () =>
        federationMock.sendMessage(channelId, req.payload, req.message_type),
    )
  },

  /** 创建 Channel WebSocket 连接 */
  connectChannelWs(channelId: string): WebSocket {
    if (shouldUseMock()) return createMockWs()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = location.host
    return new WebSocket(
      `${proto}//${base}/api${PREFIX}/channels/${channelId}/ws`,
    )
  },

  // ==================== Room 多方通信 ====================

  /** 获取 Room 列表 */
  getRooms(): Promise<RoomListResponse> {
    return withDevFallback(
      () => apiService.get<RoomListResponse>(`${PREFIX}/rooms`),
      () => federationMock.getRooms(),
    )
  },

  /** 创建 Room */
  createRoom(req: CreateRoomRequest): Promise<RoomDetail> {
    return withDevFallback(
      () => apiService.post<RoomDetail>(`${PREFIX}/rooms`, req),
      () => federationMock.createRoom(req) as Promise<RoomDetail>,
    )
  },

  /** 更新 Room */
  updateRoom(roomId: string, req: UpdateRoomRequest): Promise<RoomDetail> {
    return withDevFallback(
      () => apiService.put<RoomDetail>(`${PREFIX}/rooms/${roomId}`, req),
      () => federationMock.updateRoom(roomId, req as Record<string, unknown>),
    )
  },

  /** 获取 Room 详情 */
  getRoom(roomId: string): Promise<RoomDetail> {
    return withDevFallback(
      () => apiService.get<RoomDetail>(`${PREFIX}/rooms/${roomId}`),
      () => federationMock.getRoom(roomId),
    )
  },

  /** 获取 Room 成员 */
  getRoomMembers(roomId: string): Promise<RoomMembersResponse> {
    return withDevFallback(
      () =>
        apiService.get<RoomMembersResponse>(
          `${PREFIX}/rooms/${roomId}/members`,
        ),
      () => federationMock.getRoomMembers(roomId),
    )
  },

  /** 邀请成员 */
  inviteMember(
    roomId: string,
    req: InviteMemberRequest,
  ): Promise<{ success: boolean }> {
    return withDevFallback(
      () =>
        apiService.post<{ success: boolean }>(
          `${PREFIX}/rooms/${roomId}/invite`,
          req,
        ),
      () => federationMock.inviteMember(roomId, req),
    )
  },

  /** 移除成员 */
  removeMember(
    roomId: string,
    actorUrl: string,
  ): Promise<{ success: boolean }> {
    return withDevFallback(
      () =>
        apiService.delete<{ success: boolean }>(
          `${PREFIX}/rooms/${roomId}/members/${encodeURIComponent(actorUrl)}`,
        ),
      () => federationMock.removeMember(roomId, actorUrl),
    )
  },

  /** 离开 Room */
  leaveRoom(roomId: string): Promise<{ success: boolean }> {
    return withDevFallback(
      () =>
        apiService.post<{ success: boolean }>(
          `${PREFIX}/rooms/${roomId}/leave`,
          {},
        ),
      () => federationMock.leaveRoom(roomId),
    )
  },

  /** 解散 Room（仅 owner） */
  deleteRoom(roomId: string): Promise<{ success: boolean }> {
    return withDevFallback(
      () =>
        apiService.delete<{ success: boolean }>(`${PREFIX}/rooms/${roomId}`),
      () => federationMock.deleteRoom(roomId),
    )
  },

  /** 获取 Room 消息 */
  getRoomMessages(
    roomId: string,
    before?: string,
    limit?: number,
  ): Promise<RoomMessageListResponse> {
    return withDevFallback(
      () => {
        const params = new URLSearchParams()
        if (before) params.set('before', before)
        if (limit) params.set('limit', String(limit))
        const qs = params.toString()
        return apiService.get<RoomMessageListResponse>(
          `${PREFIX}/rooms/${roomId}/messages${qs ? `?${qs}` : ''}`,
        )
      },
      () => federationMock.getRoomMessages(roomId),
    )
  },

  /** 发送 Room 消息 */
  sendRoomMessage(
    roomId: string,
    req: SendRoomMessageRequest,
  ): Promise<SendRoomMessageResponse> {
    return withDevFallback(
      () =>
        apiService.post<SendRoomMessageResponse>(
          `${PREFIX}/rooms/${roomId}/messages`,
          req,
        ),
      () =>
        federationMock.sendRoomMessage(roomId, req.payload, req.message_type),
    )
  },

  /** Pin/Unpin Room 消息 */
  pinRoomMessage(
    roomId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<import('../types/federation').PinRoomMessageResponse> {
    return withDevFallback(
      () =>
        apiService.post<import('../types/federation').PinRoomMessageResponse>(
          `${PREFIX}/rooms/${roomId}/messages/${messageId}/pin`,
          { pinned },
        ),
      () => federationMock.pinRoomMessage(roomId, messageId, pinned),
    )
  },

  /** 创建 Room WebSocket 连接 */
  connectRoomWs(roomId: string): WebSocket {
    if (shouldUseMock()) return createMockWs()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = location.host
    return new WebSocket(`${proto}//${base}/api${PREFIX}/rooms/${roomId}/ws`)
  },

  // ==================== Ring ====================

  /** 获取 Ring 列表 */
  getRings(): Promise<RingListResponse> {
    return withDevFallback(
      () => apiService.get<RingListResponse>(`${PREFIX}/rings`),
      () => federationMock.getRings(),
    )
  },

  /** 创建 Ring */
  createRing(req: CreateRingRequest): Promise<RingDetail> {
    return apiService.post<RingDetail>(`${PREFIX}/rings`, req)
  },

  /** 获取 Ring 详情 */
  getRing(ringId: string): Promise<RingDetail> {
    return withDevFallback(
      () => apiService.get<RingDetail>(`${PREFIX}/rings/${ringId}`),
      () => federationMock.getRing(ringId),
    )
  },

  /** 离开 Ring */
  leaveRing(ringId: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(
      `${PREFIX}/rings/${ringId}/leave`,
      {},
    )
  },

  /** 获取 Ring Peer 列表 */
  getRingPeers(ringId: string): Promise<RingPeersResponse> {
    return withDevFallback(
      () =>
        apiService.get<RingPeersResponse>(`${PREFIX}/rings/${ringId}/peers`),
      () => federationMock.getRingPeers(ringId),
    )
  },

  /** 添加 Peer */
  addPeer(ringId: string, req: AddPeerRequest): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(
      `${PREFIX}/rings/${ringId}/peers`,
      req,
    )
  },

  /** 移除 Peer */
  removePeer(ringId: string, peerUrl: string): Promise<{ success: boolean }> {
    return apiService.delete<{ success: boolean }>(
      `${PREFIX}/rings/${ringId}/peers/${encodeURIComponent(peerUrl)}`,
    )
  },

  /** 触发 Gossip 同步 */
  triggerSync(ringId: string): Promise<{
    success: boolean
    synced_peers: number
    entries_count: number
  }> {
    return withDevFallback(
      () =>
        apiService.post<{
          success: boolean
          synced_peers: number
          entries_count: number
        }>(`${PREFIX}/rings/${ringId}/sync`, {}),
      () => federationMock.triggerSync(ringId),
    )
  },

  // ==================== Trust 策略管理 ====================

  /** 获取信任策略 */
  getTrustPolicy(): Promise<TrustPolicyResponse> {
    return apiService.get<TrustPolicyResponse>(`${PREFIX}/trust/policy`)
  },

  /** 列出所有已知实例 */
  getInstances(): Promise<InstanceListResponse> {
    return apiService.get<InstanceListResponse>(`${PREFIX}/trust/instances`)
  },

  /** 更新实例信任层级 */
  updateInstanceTrust(req: UpdateTrustRequest): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/trust/update`, req)
  },

  /** 封禁/解封实例 */
  toggleInstanceBlock(req: ToggleBlockRequest): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/trust/block`, req)
  },

  // ==================== 文件传输 ====================

  /** 发起文件传输 */
  initiateTransfer(
    channelId: string,
    req: InitTransferRequest,
  ): Promise<TransferDetail> {
    return apiService.post<TransferDetail>(
      `${PREFIX}/channels/${channelId}/transfers`,
      req,
    )
  },

  /** 列出 Channel 的文件传输 */
  listTransfers(channelId: string): Promise<TransferListResponse> {
    return apiService.get<TransferListResponse>(
      `${PREFIX}/channels/${channelId}/transfers`,
    )
  },

  /** 获取传输详情 */
  getTransfer(transferId: string): Promise<TransferDetail> {
    return apiService.get<TransferDetail>(`${PREFIX}/transfers/${transferId}`)
  },

  /** 上传文件分块 */
  uploadChunk(
    transferId: string,
    req: UploadChunkRequest,
  ): Promise<{ success: boolean; progress: number }> {
    return apiService.post<{ success: boolean; progress: number }>(
      `${PREFIX}/transfers/${transferId}/chunks`,
      req,
    )
  },

  /** 取消传输 */
  cancelTransfer(transferId: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(
      `${PREFIX}/transfers/${transferId}/cancel`,
      {},
    )
  },
}
