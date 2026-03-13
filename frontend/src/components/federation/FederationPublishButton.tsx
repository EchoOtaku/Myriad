/**
 * 联邦发布按钮 — 可嵌入报告/Brew/Library 页面
 *
 * 用法:
 * <FederationPublishButton contentType="report" contentId="42" />
 */

import type { PublishRequest } from '../../types/federation'
import { useCallback, useEffect, useState } from 'react'
import { federationApi } from '../../services/federationApi'

interface Props {
  contentType: PublishRequest['content_type']
  contentId: string
  visibility?: PublishRequest['visibility']
  className?: string
}

export default function FederationPublishButton({
  contentType,
  contentId,
  visibility = 'public',
  className = '',
}: Props) {
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  // 检查是否已发布
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await federationApi.getPublished()
        if (!cancelled) {
          const found = res.items.some(
            item => item.content_type === contentType && item.content_id === contentId,
          )
          setPublished(found)
        }
      }
      catch {
        // 未认证或联邦功能未启用，静默忽略
      }
      finally {
        if (!cancelled)
          setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [contentType, contentId])

  const handleToggle = useCallback(async () => {
    setLoading(true)
    try {
      if (published) {
        await federationApi.unpublish({ content_type: contentType, content_id: contentId })
        setPublished(false)
      }
      else {
        await federationApi.publish({ content_type: contentType, content_id: contentId, visibility })
        setPublished(true)
      }
    }
    catch {
      // 静默处理错误
    }
    finally {
      setLoading(false)
    }
  }, [published, contentType, contentId, visibility])

  if (checking)
    return null

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={loading}
      title={published ? '取消联邦发布' : '发布到联邦网络'}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
        published
          ? 'bg-accent/20 text-accent border border-accent/30 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30'
          : 'bg-card-bg text-secondary border border-border/30 hover:text-accent hover:border-accent/30'
      } disabled:opacity-50 ${className}`}
    >
      {loading ? (
        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <span>{published ? '📡' : '🌐'}</span>
      )}
      {published ? '已发布' : '联邦发布'}
    </button>
  )
}
