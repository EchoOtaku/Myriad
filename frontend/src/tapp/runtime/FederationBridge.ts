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
}
