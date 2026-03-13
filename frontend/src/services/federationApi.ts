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
  UpdateTrustRequest,
  UploadChunkRequest,
} from '../types/federation'
import { apiService } from './api'

const PREFIX = '/federation'

export const federationApi = {
  // ==================== 关注管理 ====================

  /** 关注远程用户 */
  follow(target: string): Promise<FollowResponse> {
    return apiService.post<FollowResponse>(`${PREFIX}/follow`, { target } satisfies FollowRequest)
  },

  /** 取消关注 */
  unfollow(target: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/unfollow`, { target } satisfies FollowRequest)
  },

  /** 获取我关注的远程用户 */
  getFollowing(): Promise<FollowListResponse> {
    return apiService.get<FollowListResponse>(`${PREFIX}/following`)
  },

  /** 获取关注我的远程用户 */
  getFollowers(): Promise<FollowListResponse> {
    return apiService.get<FollowListResponse>(`${PREFIX}/followers`)
  },

  // ==================== 时间线 ====================

  /** 获取联邦时间线 */
  getTimeline(): Promise<TimelineResponse> {
    return apiService.get<TimelineResponse>(`${PREFIX}/timeline`)
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
    return apiService.get<PublishedListResponse>(`${PREFIX}/published`)
  },

  // ==================== Channel 通信 ====================

  /** 获取 Channel 列表 */
  getChannels(): Promise<ChannelListResponse> {
    return apiService.get<ChannelListResponse>(`${PREFIX}/channels`)
  },

  /** 创建 Channel */
  createChannel(req: CreateChannelRequest): Promise<ChannelDetail> {
    return apiService.post<ChannelDetail>(`${PREFIX}/channels`, req)
  },

  /** 获取 Channel 详情 */
  getChannel(channelId: string): Promise<ChannelDetail> {
    return apiService.get<ChannelDetail>(`${PREFIX}/channels/${channelId}`)
  },

  /** 关闭 Channel */
  closeChannel(channelId: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/channels/${channelId}/close`, {})
  },

  /** 接受 Channel */
  acceptChannel(channelId: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/channels/${channelId}/accept`, {})
  },

  /** 获取消息历史 */
  getMessages(channelId: string, before?: string, limit?: number): Promise<MessageListResponse> {
    const params = new URLSearchParams()
    if (before)
      params.set('before', before)
    if (limit)
      params.set('limit', String(limit))
    const qs = params.toString()
    return apiService.get<MessageListResponse>(`${PREFIX}/channels/${channelId}/messages${qs ? `?${qs}` : ''}`)
  },

  /** 发送消息 */
  sendMessage(channelId: string, req: SendMessageRequest): Promise<SendMessageResponse> {
    return apiService.post<SendMessageResponse>(`${PREFIX}/channels/${channelId}/messages`, req)
  },

  /** 创建 Channel WebSocket 连接 */
  connectChannelWs(channelId: string): WebSocket {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = location.host
    return new WebSocket(`${proto}//${base}/api${PREFIX}/channels/${channelId}/ws`)
  },

  // ==================== Room 多方通信 ====================

  /** 获取 Room 列表 */
  getRooms(): Promise<RoomListResponse> {
    return apiService.get<RoomListResponse>(`${PREFIX}/rooms`)
  },

  /** 创建 Room */
  createRoom(req: CreateRoomRequest): Promise<RoomDetail> {
    return apiService.post<RoomDetail>(`${PREFIX}/rooms`, req)
  },

  /** 获取 Room 详情 */
  getRoom(roomId: string): Promise<RoomDetail> {
    return apiService.get<RoomDetail>(`${PREFIX}/rooms/${roomId}`)
  },

  /** 获取 Room 成员 */
  getRoomMembers(roomId: string): Promise<RoomMembersResponse> {
    return apiService.get<RoomMembersResponse>(`${PREFIX}/rooms/${roomId}/members`)
  },

  /** 邀请成员 */
  inviteMember(roomId: string, req: InviteMemberRequest): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/rooms/${roomId}/invite`, req)
  },

  /** 移除成员 */
  removeMember(roomId: string, actorUrl: string): Promise<{ success: boolean }> {
    return apiService.delete<{ success: boolean }>(`${PREFIX}/rooms/${roomId}/members/${encodeURIComponent(actorUrl)}`)
  },

  /** 离开 Room */
  leaveRoom(roomId: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/rooms/${roomId}/leave`, {})
  },

  /** 获取 Room 消息 */
  getRoomMessages(roomId: string, before?: string, limit?: number): Promise<RoomMessageListResponse> {
    const params = new URLSearchParams()
    if (before)
      params.set('before', before)
    if (limit)
      params.set('limit', String(limit))
    const qs = params.toString()
    return apiService.get<RoomMessageListResponse>(`${PREFIX}/rooms/${roomId}/messages${qs ? `?${qs}` : ''}`)
  },

  /** 发送 Room 消息 */
  sendRoomMessage(roomId: string, req: SendRoomMessageRequest): Promise<SendRoomMessageResponse> {
    return apiService.post<SendRoomMessageResponse>(`${PREFIX}/rooms/${roomId}/messages`, req)
  },

  /** 创建 Room WebSocket 连接 */
  connectRoomWs(roomId: string): WebSocket {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = location.host
    return new WebSocket(`${proto}//${base}/api${PREFIX}/rooms/${roomId}/ws`)
  },

  // ==================== Ring ====================

  /** 获取 Ring 列表 */
  getRings(): Promise<RingListResponse> {
    return apiService.get<RingListResponse>(`${PREFIX}/rings`)
  },

  /** 创建 Ring */
  createRing(req: CreateRingRequest): Promise<RingDetail> {
    return apiService.post<RingDetail>(`${PREFIX}/rings`, req)
  },

  /** 获取 Ring 详情 */
  getRing(ringId: string): Promise<RingDetail> {
    return apiService.get<RingDetail>(`${PREFIX}/rings/${ringId}`)
  },

  /** 离开 Ring */
  leaveRing(ringId: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/rings/${ringId}/leave`, {})
  },

  /** 获取 Ring Peer 列表 */
  getRingPeers(ringId: string): Promise<RingPeersResponse> {
    return apiService.get<RingPeersResponse>(`${PREFIX}/rings/${ringId}/peers`)
  },

  /** 添加 Peer */
  addPeer(ringId: string, req: AddPeerRequest): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/rings/${ringId}/peers`, req)
  },

  /** 移除 Peer */
  removePeer(ringId: string, peerUrl: string): Promise<{ success: boolean }> {
    return apiService.delete<{ success: boolean }>(`${PREFIX}/rings/${ringId}/peers/${encodeURIComponent(peerUrl)}`)
  },

  /** 触发 Gossip 同步 */
  triggerSync(ringId: string): Promise<{ success: boolean; synced_peers: number; entries_count: number }> {
    return apiService.post<{ success: boolean; synced_peers: number; entries_count: number }>(`${PREFIX}/rings/${ringId}/sync`, {})
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
  initiateTransfer(channelId: string, req: InitTransferRequest): Promise<TransferDetail> {
    return apiService.post<TransferDetail>(`${PREFIX}/channels/${channelId}/transfers`, req)
  },

  /** 列出 Channel 的文件传输 */
  listTransfers(channelId: string): Promise<TransferListResponse> {
    return apiService.get<TransferListResponse>(`${PREFIX}/channels/${channelId}/transfers`)
  },

  /** 获取传输详情 */
  getTransfer(transferId: string): Promise<TransferDetail> {
    return apiService.get<TransferDetail>(`${PREFIX}/transfers/${transferId}`)
  },

  /** 上传文件分块 */
  uploadChunk(transferId: string, req: UploadChunkRequest): Promise<{ success: boolean; progress: number }> {
    return apiService.post<{ success: boolean; progress: number }>(`${PREFIX}/transfers/${transferId}/chunks`, req)
  },

  /** 取消传输 */
  cancelTransfer(transferId: string): Promise<{ success: boolean }> {
    return apiService.post<{ success: boolean }>(`${PREFIX}/transfers/${transferId}/cancel`, {})
  },
}
