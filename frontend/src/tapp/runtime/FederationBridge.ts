/**
 * Federation Bridge — Tapp 运行时联邦能力桥接
 *
 * 为 Tapp 沙箱提供联邦 API 访问能力
 * 通过 TappBridge 消息机制暴露受限的联邦操作
 *
 * 支持的操作域：
 * - federation.timeline — 读取联邦时间线
 * - federation.follow / unfollow — 关注管理
 * - federation.channels — Channel 读取与消息发送
 * - federation.rooms — Room 读取与消息发送
 * - federation.rings — Ring 信息读取
 * - federation.publish / unpublish — 内容发布管理
 */

import type { TappInstance, TappMessage } from '../types'
import type { TappBridge } from './TappBridge'
import { federationApi } from '../../services/federationApi'

/**
 * 注册联邦处理器到 TappBridge
 */
export function registerFederationHandlers(
  bridge: TappBridge,
  _tappInstance: TappInstance,
): void {
  // ==================== 时间线 ====================

  bridge.registerHandler('federation.getTimeline', async () => {
    try {
      const data = await federationApi.getTimeline()
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get timeline' }
    }
  })

  // ==================== 关注管理 ====================

  bridge.registerHandler('federation.follow', async (message: TappMessage) => {
    const [target] = (message.payload as { args: unknown[] }).args || []
    if (!target || typeof target !== 'string')
      return { success: false, error: 'Target actor URL is required' }
    try {
      const data = await federationApi.follow(target)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to follow' }
    }
  })

  bridge.registerHandler('federation.unfollow', async (message: TappMessage) => {
    const [target] = (message.payload as { args: unknown[] }).args || []
    if (!target || typeof target !== 'string')
      return { success: false, error: 'Target actor URL is required' }
    try {
      const data = await federationApi.unfollow(target)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to unfollow' }
    }
  })

  bridge.registerHandler('federation.getFollowing', async () => {
    try {
      const data = await federationApi.getFollowing()
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.getFollowers', async () => {
    try {
      const data = await federationApi.getFollowers()
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // ==================== 内容发布 ====================

  bridge.registerHandler('federation.publish', async (message: TappMessage) => {
    const [req] = (message.payload as { args: unknown[] }).args || []
    if (!req)
      return { success: false, error: 'Publish request is required' }
    try {
      const data = await federationApi.publish(req as Parameters<typeof federationApi.publish>[0])
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to publish' }
    }
  })

  bridge.registerHandler('federation.unpublish', async (message: TappMessage) => {
    const [req] = (message.payload as { args: unknown[] }).args || []
    if (!req)
      return { success: false, error: 'Unpublish request is required' }
    try {
      const data = await federationApi.unpublish(req as Parameters<typeof federationApi.unpublish>[0])
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to unpublish' }
    }
  })

  bridge.registerHandler('federation.getPublished', async () => {
    try {
      const data = await federationApi.getPublished()
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // ==================== Channel ====================

  bridge.registerHandler('federation.getChannels', async () => {
    try {
      const data = await federationApi.getChannels()
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.createChannel', async (message: TappMessage) => {
    const [req] = (message.payload as { args: unknown[] }).args || []
    if (!req)
      return { success: false, error: 'Create channel request is required' }
    try {
      const data = await federationApi.createChannel(req as Parameters<typeof federationApi.createChannel>[0])
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create channel' }
    }
  })

  bridge.registerHandler('federation.acceptChannel', async (message: TappMessage) => {
    const [channelId] = (message.payload as { args: unknown[] }).args || []
    if (!channelId || typeof channelId !== 'string')
      return { success: false, error: 'Channel ID is required' }
    try {
      const data = await federationApi.acceptChannel(channelId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to accept channel' }
    }
  })

  bridge.registerHandler('federation.closeChannel', async (message: TappMessage) => {
    const [channelId] = (message.payload as { args: unknown[] }).args || []
    if (!channelId || typeof channelId !== 'string')
      return { success: false, error: 'Channel ID is required' }
    try {
      const data = await federationApi.closeChannel(channelId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to close channel' }
    }
  })

  bridge.registerHandler('federation.getChannel', async (message: TappMessage) => {
    const [channelId] = (message.payload as { args: unknown[] }).args || []
    if (!channelId || typeof channelId !== 'string')
      return { success: false, error: 'Channel ID is required' }
    try {
      const data = await federationApi.getChannel(channelId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.getMessages', async (message: TappMessage) => {
    const [channelId, before, limit] = (message.payload as { args: unknown[] }).args || []
    if (!channelId || typeof channelId !== 'string')
      return { success: false, error: 'Channel ID is required' }
    try {
      const data = await federationApi.getMessages(
        channelId,
        before as string | undefined,
        limit as number | undefined,
      )
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.sendMessage', async (message: TappMessage) => {
    const [channelId, req] = (message.payload as { args: unknown[] }).args || []
    if (!channelId || typeof channelId !== 'string' || !req)
      return { success: false, error: 'Channel ID and message are required' }
    try {
      const data = await federationApi.sendMessage(
        channelId,
        req as Parameters<typeof federationApi.sendMessage>[1],
      )
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // ==================== Room ====================

  bridge.registerHandler('federation.getRooms', async () => {
    try {
      const data = await federationApi.getRooms()
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.getRoom', async (message: TappMessage) => {
    const [roomId] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string')
      return { success: false, error: 'Room ID is required' }
    try {
      const data = await federationApi.getRoom(roomId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.createRoom', async (message: TappMessage) => {
    const [req] = (message.payload as { args: unknown[] }).args || []
    if (!req)
      return { success: false, error: 'Create room request is required' }
    try {
      const data = await federationApi.createRoom(req as Parameters<typeof federationApi.createRoom>[0])
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create room' }
    }
  })

  bridge.registerHandler('federation.updateRoom', async (message: TappMessage) => {
    const [roomId, req] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string')
      return { success: false, error: 'Room ID is required' }
    if (!req)
      return { success: false, error: 'Update room request is required' }
    try {
      const data = await federationApi.updateRoom(roomId, req as Parameters<typeof federationApi.updateRoom>[1])
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update room' }
    }
  })

  bridge.registerHandler('federation.getRoomMembers', async (message: TappMessage) => {
    const [roomId] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string')
      return { success: false, error: 'Room ID is required' }
    try {
      const data = await federationApi.getRoomMembers(roomId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get members' }
    }
  })

  bridge.registerHandler('federation.inviteMember', async (message: TappMessage) => {
    const [roomId, req] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string' || !req)
      return { success: false, error: 'Room ID and invite request are required' }
    try {
      const data = await federationApi.inviteMember(
        roomId,
        req as Parameters<typeof federationApi.inviteMember>[1],
      )
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to invite' }
    }
  })

  bridge.registerHandler('federation.removeMember', async (message: TappMessage) => {
    const [roomId, actorUrl] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string' || !actorUrl || typeof actorUrl !== 'string')
      return { success: false, error: 'Room ID and actor URL are required' }
    try {
      const data = await federationApi.removeMember(roomId, actorUrl)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to remove member' }
    }
  })

  bridge.registerHandler('federation.leaveRoom', async (message: TappMessage) => {
    const [roomId] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string')
      return { success: false, error: 'Room ID is required' }
    try {
      const data = await federationApi.leaveRoom(roomId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to leave room' }
    }
  })

  bridge.registerHandler('federation.deleteRoom', async (message: TappMessage) => {
    const [roomId] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string')
      return { success: false, error: 'Room ID is required' }
    try {
      const data = await federationApi.deleteRoom(roomId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete room' }
    }
  })

  bridge.registerHandler('federation.getRoomMessages', async (message: TappMessage) => {
    const [roomId, before, limit] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string')
      return { success: false, error: 'Room ID is required' }
    try {
      const data = await federationApi.getRoomMessages(
        roomId,
        before as string | undefined,
        limit as number | undefined,
      )
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.sendRoomMessage', async (message: TappMessage) => {
    const [roomId, req] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string' || !req)
      return { success: false, error: 'Room ID and message are required' }
    try {
      const data = await federationApi.sendRoomMessage(
        roomId,
        req as Parameters<typeof federationApi.sendRoomMessage>[1],
      )
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // ==================== Pin Room Message ====================

  bridge.registerHandler('federation.pinRoomMessage', async (message: TappMessage) => {
    const [roomId, messageId, pinned] = (message.payload as { args: unknown[] }).args || []
    if (!roomId || typeof roomId !== 'string' || !messageId || typeof messageId !== 'string')
      return { success: false, error: 'Room ID and Message ID are required' }
    try {
      const data = await federationApi.pinRoomMessage(roomId, messageId, !!pinned)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // ==================== Ring (只读) ====================

  bridge.registerHandler('federation.getRings', async () => {
    try {
      const data = await federationApi.getRings()
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.getRing', async (message: TappMessage) => {
    const [ringId] = (message.payload as { args: unknown[] }).args || []
    if (!ringId || typeof ringId !== 'string')
      return { success: false, error: 'Ring ID is required' }
    try {
      const data = await federationApi.getRing(ringId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.getRingPeers', async (message: TappMessage) => {
    const [ringId] = (message.payload as { args: unknown[] }).args || []
    if (!ringId || typeof ringId !== 'string')
      return { success: false, error: 'Ring ID is required' }
    try {
      const data = await federationApi.getRingPeers(ringId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.createRing', async (message: TappMessage) => {
    const [req] = (message.payload as { args: unknown[] }).args || []
    if (!req || typeof req !== 'object')
      return { success: false, error: 'Ring request is required' }
    try {
      const data = await federationApi.createRing(req as any)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.leaveRing', async (message: TappMessage) => {
    const [ringId] = (message.payload as { args: unknown[] }).args || []
    if (!ringId || typeof ringId !== 'string')
      return { success: false, error: 'Ring ID is required' }
    try {
      const data = await federationApi.leaveRing(ringId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.addPeer', async (message: TappMessage) => {
    const [ringId, req] = (message.payload as { args: unknown[] }).args || []
    if (!ringId || typeof ringId !== 'string')
      return { success: false, error: 'Ring ID is required' }
    if (!req || typeof req !== 'object')
      return { success: false, error: 'Peer request is required' }
    try {
      const data = await federationApi.addPeer(ringId, req as any)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.removePeer', async (message: TappMessage) => {
    const [ringId, peerUrl] = (message.payload as { args: unknown[] }).args || []
    if (!ringId || typeof ringId !== 'string')
      return { success: false, error: 'Ring ID is required' }
    if (!peerUrl || typeof peerUrl !== 'string')
      return { success: false, error: 'Peer URL is required' }
    try {
      const data = await federationApi.removePeer(ringId, peerUrl)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  bridge.registerHandler('federation.triggerSync', async (message: TappMessage) => {
    const [ringId] = (message.payload as { args: unknown[] }).args || []
    if (!ringId || typeof ringId !== 'string')
      return { success: false, error: 'Ring ID is required' }
    try {
      const data = await federationApi.triggerSync(ringId)
      return { success: true, data }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed' }
    }
  })
}
