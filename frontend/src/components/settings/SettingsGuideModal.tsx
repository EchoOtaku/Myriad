/**
 * 选项详细指南弹窗（只读）。
 * 精简：标题 + 关闭 + 正文，无多余装饰。
 */

import type { ReactNode } from 'react'
import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FaTimes } from '@lib/icons'
import { useI18n } from '../../contexts/I18nContext'
import './SettingsGuideModal.css'

export interface SettingsGuideModalProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}

export const SettingsGuideModal: React.FC<SettingsGuideModalProps> = ({
  open,
  title,
  children,
  onClose,
}) => {
  const { t } = useI18n()
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    const id = window.requestAnimationFrame(() => closeRef.current?.focus())
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      window.cancelAnimationFrame(id)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const closeLabel = t.common.close ?? '关闭'
  const fallbackTitle = t.config.optionGuide ?? '选项指南'

  return createPortal(
    <div
      className="settings-guide-modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="settings-guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-guide-modal-header">
          <h3 id={titleId} className="settings-guide-modal-title">
            {title || fallbackTitle}
          </h3>
          <button
            ref={closeRef}
            type="button"
            className="settings-guide-modal-close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <FaTimes aria-hidden />
          </button>
        </div>
        <div className="settings-guide-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

SettingsGuideModal.displayName = 'SettingsGuideModal'

export default SettingsGuideModal
