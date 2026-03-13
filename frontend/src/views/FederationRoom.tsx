/**
 * 联邦 Room 群聊视图
 */

import type { RoomDetail, RoomMember, RoomMessageItem, WsMessage } from '../types/federation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AnimatedView from '../components/AnimatedView'
import { useI18n } from '../contexts/I18nContext'
import { federationApi } from '../services/federationApi'

export default function FederationRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { t } = useI18n()
  const fedT = t.federation

  const [room, setRoom] = useState<RoomDetail | null>(null)
  const [members, setMembers] = useState<RoomMember[]>([])
  const [messages, setMessages] = useState<RoomMessageItem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [inviteTarget, setInviteTarget] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // 加载 Room 详情、成员、消息
  useEffect(() => {
    if (!roomId)
      return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [detail, memberRes, history] = await Promise.all([
          federationApi.getRoom(roomId!),
          federationApi.getRoomMembers(roomId!),
          federationApi.getRoomMessages(roomId!, undefined, 100),
        ])
        if (cancelled)
          return
        setRoom(detail)
        setMembers(memberRes.members)
        setMessages(history.messages)
      }
      catch (err: any) {
        if (!cancelled)
          setError(err.message || 'Failed to load room')
      }
      finally {
        if (!cancelled)
          setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [roomId])

  // WebSocket 连接
  useEffect(() => {
    if (!roomId || !room)
      return

    const ws = federationApi.connectRoomWs(roomId)
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)

    ws.onmessage = (event) => {
      try {
        const data: WsMessage = JSON.parse(event.data)
        switch (data.type) {
          case 'message':
            if (data.message && 'message_id' in data.message) {
              const msg = data.message as RoomMessageItem
              setMessages((prev) => {
                if (prev.some(m => m.message_id === msg.message_id))
                  return prev
                return [...prev, msg]
              })
              scrollToBottom()
            }
            break
          case 'typing':
            break
        }
        // Handle system events (member join/leave)
        if (data.type === 'system' as string) {
          // Reload members on membership changes
          federationApi.getRoomMembers(roomId).then(res => setMembers(res.members)).catch(() => {})
        }
      }
      catch { /* ignore parse errors */ }
    }

    ws.onclose = () => setWsConnected(false)
    ws.onerror = () => setWsConnected(false)

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [roomId, room, scrollToBottom])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || !roomId || sending)
      return
    const text = input.trim()
    setInput('')
    setSending(true)

    try {
      await federationApi.sendRoomMessage(roomId, {
        payload: { text },
        message_type: 'text',
      })
    }
    catch (err: any) {
      setError(err.message || 'Send failed')
      setInput(text)
    }
    finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // 邀请成员
  const handleInvite = async () => {
    if (!inviteTarget.trim() || !roomId)
      return
    try {
      await federationApi.inviteMember(roomId, { actor: inviteTarget.trim() })
      setInviteTarget('')
      const res = await federationApi.getRoomMembers(roomId)
      setMembers(res.members)
    }
    catch (err: any) {
      setError(err.message || 'Invite failed')
    }
  }

  // 离开房间
  const handleLeave = async () => {
    if (!roomId)
      return
    try {
      await federationApi.leaveRoom(roomId)
      navigate('/federation')
    }
    catch (err: any) {
      setError(err.message || 'Leave failed')
    }
  }

  if (loading) {
    return (
      <AnimatedView className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </AnimatedView>
    )
  }

  if (!room) {
    return (
      <AnimatedView className="min-h-screen flex items-center justify-center">
        <div className="text-secondary">{error || 'Room not found'}</div>
      </AnimatedView>
    )
  }

  const isAdmin = room.my_role === 'owner' || room.my_role === 'admin'
  const isObserver = room.my_role === 'observer'

  return (
    <AnimatedView className="min-h-screen flex flex-col">
      {/* 顶栏 */}
      <div className="fixed top-0 left-0 right-0 z-30 bg-primary-bg/80 backdrop-blur-lg border-b border-border/30">
        <div className="max-w-4xl mx-auto flex items-center gap-3 px-4 h-14">
          <button
            type="button"
            onClick={() => navigate('/federation')}
            className="text-secondary hover:text-primary transition-colors"
          >
            ←
            {' '}
            {fedT.back || '返回'}
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-primary truncate">{room.name}</div>
            <div className="flex items-center gap-2 text-xs text-secondary">
              <span>
                {room.member_count}
                {' '}
                {fedT.roomMembers || '成员'}
              </span>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-gray-400'}`} />
              <span>{wsConnected ? (fedT.connected || '已连接') : (fedT.disconnected || '未连接')}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowMembers(!showMembers)}
            className="text-xs text-secondary hover:text-primary px-3 py-1.5 rounded-lg hover:bg-card-bg transition-colors"
          >
            👥
          </button>
          {room.my_role !== 'owner' && (
            <button
              type="button"
              onClick={handleLeave}
              className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              {fedT.leaveRoom || '离开'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 pt-14 pb-20">
        {/* 消息区域 */}
        <div className={`flex-1 overflow-y-auto px-3 xs:px-4 sm:px-6 ${showMembers ? 'mr-64' : ''}`}>
          <div className="max-w-4xl mx-auto space-y-3 py-4">
            {messages.length === 0 ? (
              <div className="text-center py-16 text-secondary">
                <div className="text-4xl mb-3">🏠</div>
                <p>{fedT.emptyRoomHint || '发送第一条消息开始群聊'}</p>
              </div>
            ) : (
              messages.map(msg => (
                <RoomMessageBubble
                  key={msg.message_id}
                  message={msg}
                  isLocal={msg.sender_actor.includes(location.host)}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 成员侧边栏 */}
        {showMembers && (
          <div className="fixed right-0 top-14 bottom-20 w-64 bg-card-bg border-l border-border/30 overflow-y-auto z-20">
            <div className="p-3">
              <h3 className="text-sm font-medium text-primary mb-3">
                {fedT.roomMembers || '成员'}
                {' '}
                (
                {members.length}
                )
              </h3>
              {isAdmin && (
                <div className="flex gap-1 mb-3">
                  <input
                    type="text"
                    value={inviteTarget}
                    onChange={e => setInviteTarget(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                    placeholder={fedT.invitePlaceholder || '用户名或 Actor URL'}
                    className="flex-1 px-2 py-1 rounded text-xs bg-primary-bg border border-border/30 text-primary placeholder:text-secondary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleInvite}
                    disabled={!inviteTarget.trim()}
                    className="px-2 py-1 rounded text-xs bg-accent text-white disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              )}
              <div className="space-y-1">
                {members.map(m => (
                  <div key={m.actor_url} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-primary-bg/50">
                    <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs">
                      {(m.display_name || m.actor_url.split('/').pop() || '?')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-primary truncate">
                        {m.display_name || m.actor_url.split('/').pop()}
                      </div>
                      <div className="text-[10px] text-secondary">{m.role}</div>
                    </div>
                    {m.is_local && <span className="text-[10px] text-accent">本地</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入栏 */}
      {!isObserver && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-primary-bg/80 backdrop-blur-lg border-t border-border/30">
          <div className="max-w-4xl mx-auto flex items-center gap-2 px-4 py-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={fedT.messagePlaceholder || '输入消息...'}
              className="flex-1 px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm placeholder:text-secondary/50 focus:outline-none focus:border-accent/50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? '...' : (fedT.sendBtn || '发送')}
            </button>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="fixed bottom-16 left-4 right-4 z-40 max-w-4xl mx-auto">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="ml-2 underline">✕</button>
          </div>
        </div>
      )}
    </AnimatedView>
  )
}

// ==================== Room 消息气泡 ====================

function RoomMessageBubble({ message, isLocal }: { message: RoomMessageItem, isLocal: boolean }) {
  const payload = message.payload as Record<string, unknown>
  const text = (typeof payload === 'object' && payload?.text) ? String(payload.text) : JSON.stringify(payload)

  return (
    <div className={`flex ${isLocal ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
          isLocal
            ? 'bg-accent/20 text-primary rounded-br-md'
            : 'bg-card-bg border border-border/30 text-primary rounded-bl-md'
        }`}
      >
        {!isLocal && (
          <div className="text-xs text-accent/80 mb-1 truncate">
            {message.sender_actor.split('/').pop()}
          </div>
        )}
        <div className="whitespace-pre-wrap wrap-break-word">{text}</div>
        <div className="flex items-center justify-between mt-1 gap-2">
          {message.is_pinned && <span className="text-[10px] text-yellow-400">📌</span>}
          <div className="text-xs text-secondary/60 text-right flex-1">
            {new Date(message.created_at).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  )
}
