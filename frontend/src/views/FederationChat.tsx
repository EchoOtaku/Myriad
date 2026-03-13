/**
 * 联邦 Channel 聊天视图
 */

import type { ChannelDetail, MessageItem, WsMessage } from '../types/federation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AnimatedView from '../components/AnimatedView'
import { useI18n } from '../contexts/I18nContext'
import { federationApi } from '../services/federationApi'

export default function FederationChat() {
  const { channelId } = useParams<{ channelId: string }>()
  const navigate = useNavigate()
  const { t } = useI18n()
  const fedT = t.federation

  const [channel, setChannel] = useState<ChannelDetail | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // 加载 Channel 详情和消息历史
  useEffect(() => {
    if (!channelId)
      return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [detail, history] = await Promise.all([
          federationApi.getChannel(channelId!),
          federationApi.getMessages(channelId!, undefined, 100),
        ])
        if (cancelled)
          return
        setChannel(detail)
        setMessages(history.messages)
      }
      catch (err: any) {
        if (!cancelled)
          setError(err.message || 'Failed to load channel')
      }
      finally {
        if (!cancelled)
          setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [channelId])

  // WebSocket 连接
  useEffect(() => {
    if (!channelId || !channel)
      return

    const ws = federationApi.connectChannelWs(channelId)
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)

    ws.onmessage = (event) => {
      try {
        const data: WsMessage = JSON.parse(event.data)
        switch (data.type) {
          case 'message':
            if (data.message) {
              setMessages((prev) => {
                // 去重
                if (prev.some(m => m.message_id === data.message!.message_id))
                  return prev
                return [...prev, data.message!]
              })
              scrollToBottom()
            }
            break
          case 'channel_closed':
            setChannel(prev => prev ? { ...prev, status: 'closed' } : prev)
            break
          case 'typing':
            // 可扩展打字指示器
            break
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
  }, [channelId, channel, scrollToBottom])

  // 自动滚动
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || !channelId || sending)
      return
    const text = input.trim()
    setInput('')
    setSending(true)

    try {
      await federationApi.sendMessage(channelId, {
        payload: { text },
        message_type: 'text',
      })
    }
    catch (err: any) {
      setError(err.message || 'Send failed')
      setInput(text) // 恢复输入
    }
    finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  if (loading) {
    return (
      <AnimatedView className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </AnimatedView>
    )
  }

  if (!channel) {
    return (
      <AnimatedView className="min-h-screen flex items-center justify-center">
        <div className="text-secondary">{error || 'Channel not found'}</div>
      </AnimatedView>
    )
  }

  const displayName = channel.remote_actor_name || channel.remote_actor_url.split('/').pop() || '?'
  const isClosed = channel.status === 'closed'

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
            <div className="font-medium text-primary truncate">{displayName}</div>
            <div className="flex items-center gap-2 text-xs text-secondary">
              <span>{channel.channel_type}</span>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-gray-400'}`} />
              <span>{wsConnected ? (fedT.connected || '已连接') : (fedT.disconnected || '未连接')}</span>
            </div>
          </div>
          {!isClosed && (
            <button
              type="button"
              onClick={async () => {
                await federationApi.closeChannel(channelId!)
                setChannel(prev => prev ? { ...prev, status: 'closed' } : prev)
              }}
              className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              {fedT.closeChannel || '关闭'}
            </button>
          )}
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto pt-16 pb-20 px-3 xs:px-4 sm:px-6">
        <div className="max-w-4xl mx-auto space-y-3 py-4">
          {messages.length === 0 ? (
            <div className="text-center py-16 text-secondary">
              <div className="text-4xl mb-3">💬</div>
              <p>{fedT.emptyChatHint || '发送第一条消息开始聊天'}</p>
            </div>
          ) : (
            messages.map(msg => (
              <MessageBubble
                key={msg.message_id}
                message={msg}
                isLocal={msg.sender_actor.includes(location.host)}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入栏 */}
      {!isClosed && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-primary-bg/80 backdrop-blur-lg border-t border-border/30">
          <div className="max-w-4xl mx-auto flex items-center gap-2 px-4 py-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={fedT.messagePlaceholder || '输入消息...'}
              disabled={isClosed}
              className="flex-1 px-3 py-2 rounded-lg bg-card-bg border border-border/30 text-primary text-sm placeholder:text-secondary/50 focus:outline-none focus:border-accent/50 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim() || isClosed}
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

// ==================== 消息气泡 ====================

function MessageBubble({ message, isLocal }: { message: MessageItem, isLocal: boolean }) {
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
          <div className="text-xs text-secondary mb-1 truncate">
            {message.sender_actor.split('/').pop()}
          </div>
        )}
        <div className="whitespace-pre-wrap wrap-break-word">{text}</div>
        <div className="text-xs text-secondary/60 mt-1 text-right">
          {new Date(message.created_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}
