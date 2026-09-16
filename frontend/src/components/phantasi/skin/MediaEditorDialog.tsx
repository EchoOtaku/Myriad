import type { MediaAsset } from '../../../services/mediaApi'
import {
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuImage,
  LuSlidersHorizontal,
  LuSparkles,
  LuX,
  LuZoomIn,
  LuZoomOut,
} from '@lib/icons'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../../contexts/I18nContext'
import { ApiError } from '../../../services/api'
import { previewMediaEdit, saveMediaEdit } from '../../../services/mediaApi'
import { displayImageUrl } from '../notes/noteImageUrl'
import {
  resizedDimensions,
  resizeMediaImage,
  validateMediaEditData,
  validMediaDimensions,
} from './mediaEdit'
import './MediaEditorDialog.css'

export function MediaEditorDialog({
  item,
  onClose,
  onPrevious,
  onNext,
  onSaved,
}: {
  item: MediaAsset
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  onSaved: (item: MediaAsset) => void
}) {
  const { t } = useI18n()
  const c = t.phantasi
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)
  const alive = useRef(true)
  const [source, setSource] = useState({ width: 0, height: 0 })
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [locked, setLocked] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<{
    image: string
    generated: boolean
  } | null>(null)
  const [busy, setBusy] = useState<'generate' | 'resize' | 'save' | null>(null)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [zoom, setZoom] = useState(1)
  const video = item.mime.startsWith('video/')
  const editable = ['image/png', 'image/jpeg', 'image/webp'].includes(item.mime)
  const src = displayImageUrl(item.url)
  useEffect(() => {
    alive.current = true
    const opener = document.activeElement
    const modal = dialog.current
    modal?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      alive.current = false
      if (closeTimer.current) clearTimeout(closeTimer.current)
      request.current?.abort()
      modal?.close()
      document.body.style.overflow = overflow
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  const finishClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    onClose()
  }
  const requestClose = () => {
    if (busy === 'save' || closingRef.current) return
    closingRef.current = true
    request.current?.abort()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    setClosing(true)
    // Fallback if another stylesheet disables animation or the event is lost.
    closeTimer.current = setTimeout(finishClose, 220)
  }
  const changeSize = (axis: 'width' | 'height', value: number) => {
    setDimensions(
      locked && source.width
        ? resizedDimensions(axis, value, source)
        : { ...dimensions, [axis]: value },
    )
  }
  const run = async (kind: 'generate' | 'resize' | 'save') => {
    if (pending.current || closingRef.current) return
    pending.current = true
    setBusy(kind)
    setError('')
    setSaved(false)
    const controller = new AbortController()
    request.current = controller
    try {
      if (kind === 'save' && draft) {
        const asset = await saveMediaEdit(item.id, draft.image, draft.generated)
        onSaved(asset)
        if (alive.current) {
          setDraft(null)
          setSaved(true)
        }
      } else {
        const image =
          kind === 'generate'
            ? await previewMediaEdit(
                item.id,
                prompt.trim(),
                dimensions.width,
                dimensions.height,
                controller.signal,
              )
            : await resizeMediaImage(src, dimensions.width, dimensions.height)
        validateMediaEditData(image)
        if (alive.current && !controller.signal.aborted) {
          setDraft({ image, generated: kind === 'generate' })
          setZoom(1)
        }
      }
    } catch (err) {
      if (alive.current && !controller.signal.aborted) {
        setError(
          (err instanceof ApiError && err.code === 'MEDIA_EDIT_TOO_LARGE') ||
            (err instanceof Error && err.message === 'MEDIA_EDIT_TOO_LARGE')
            ? c.mediaEditTooLarge
            : kind === 'save'
              ? c.mediaEditSaveFailed
              : c.mediaEditFailed,
        )
      }
    } finally {
      pending.current = false
      if (alive.current) setBusy(null)
    }
  }
  const canGenerate =
    validMediaDimensions(dimensions.width, dimensions.height) &&
    dimensions.width >= 256 &&
    dimensions.height >= 256 &&
    dimensions.width <= 2048 &&
    dimensions.height <= 2048
  return createPortal(
    <dialog
      ref={dialog}
      className={`media-editor${closing ? ' is-closing' : ''}`}
      onAnimationEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.animationName === 'media-editor-out'
        ) {
          finishClose()
}
      }}
      aria-label={item.name}
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <header className="media-editor__header">
        <div className="media-editor__identity">
          <span className="media-editor__file-icon">
            <LuImage aria-hidden="true" />
          </span>
          <div>
            <strong>{item.name}</strong>
            <small>
              {source.width > 0
                ? `${source.width} × ${source.height}`
                : item.mime}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="media-editor__close"
          aria-label={c.close}
          title={c.close}
          disabled={busy === 'save'}
          onClick={requestClose}
        >
          <LuX aria-hidden="true" />
        </button>
      </header>
      <div className="media-editor__body">
        <div className="media-editor__visual">
          <div
            className={`media-editor__comparison${draft ? ' has-draft' : ''}`}
          >
            <figure>
              <figcaption>{c.mediaEditOriginal}</figcaption>
              <div className="media-editor__canvas">
                {video ? (
                  <video src={src} controls />
                ) : (
                  <img
                    src={src}
                    alt={item.name}
                    style={{
                      width: `${zoom * 100}%`,
                      height: `${zoom * 100}%`,
                      maxWidth: 'none',
                    }}
                    onError={() => setError(c.mediaEditFailed)}
                    onLoad={(event) => {
                      const image = event.currentTarget
                      const size = {
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      }
                      setSource(size)
                      setDimensions(size)
                    }}
                  />
                )}
              </div>
            </figure>
            {draft && (
              <figure>
                <figcaption>
                  <LuSparkles aria-hidden="true" />
                  {c.mediaEditResult}
                </figcaption>
                <div className="media-editor__canvas">
                  <img
                    src={draft.image}
                    alt={c.mediaEditResult}
                    style={{
                      width: `${zoom * 100}%`,
                      height: `${zoom * 100}%`,
                      maxWidth: 'none',
                    }}
                  />
                </div>
              </figure>
            )}
          </div>
          <div className="media-editor__toolbar">
            <button
              type="button"
              disabled={!onPrevious || !!busy || !!draft}
              onClick={onPrevious}
              aria-label={c.mediaEditPrevious}
              title={c.mediaEditPrevious}
            >
              <LuChevronLeft aria-hidden="true" />
            </button>
            {!video && (
              <>
                <span className="media-editor__separator" />
                <button
                  type="button"
                  disabled={zoom <= 0.25}
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  aria-label={c.lightboxZoomOut}
                  title={c.lightboxZoomOut}
                >
                  <LuZoomOut aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="media-editor__zoom"
                  onClick={() => setZoom(1)}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  disabled={zoom >= 4}
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                  aria-label={c.lightboxZoomIn}
                  title={c.lightboxZoomIn}
                >
                  <LuZoomIn aria-hidden="true" />
                </button>
                <span className="media-editor__separator" />
              </>
            )}
            <button
              type="button"
              disabled={!onNext || !!busy || !!draft}
              onClick={onNext}
              aria-label={c.mediaEditNext}
              title={c.mediaEditNext}
            >
              <LuChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
        {editable && (
          <aside className="media-editor__controls">
            <fieldset disabled={!!busy}>
              <legend>
                <LuSlidersHorizontal aria-hidden="true" />
                {c.mediaEditResolution}
              </legend>
              <div className="media-editor__dimensions">
                <label>
                  {c.mediaEditWidth}
                  <span className="media-editor__number">
                    <input
                      type="number"
                      min="1"
                      max="8192"
                      aria-label={c.mediaEditWidth}
                      value={dimensions.width || ''}
                      onChange={(e) =>
                        changeSize('width', Number(e.target.value))
                      }
                    />
                    <span aria-hidden="true">px</span>
                  </span>
                </label>
                <label>
                  {c.mediaEditHeight}
                  <span className="media-editor__number">
                    <input
                      type="number"
                      min="1"
                      max="8192"
                      aria-label={c.mediaEditHeight}
                      value={dimensions.height || ''}
                      onChange={(e) =>
                        changeSize('height', Number(e.target.value))
                      }
                    />
                    <span aria-hidden="true">px</span>
                  </span>
                </label>
              </div>
              <label className="media-editor__check">
                <input
                  type="checkbox"
                  checked={locked}
                  onChange={(e) => setLocked(e.target.checked)}
                />
                <span className="media-editor__switch" aria-hidden="true" />
                {c.mediaEditLock}
              </label>
              <button
                type="button"
                className="media-editor__wide"
                disabled={
                  !validMediaDimensions(dimensions.width, dimensions.height) ||
                  !source.width
                }
                onClick={() => void run('resize')}
              >
                {c.mediaEditResize}
              </button>
            </fieldset>
            <fieldset disabled={!!busy} className="media-editor__ai">
              <legend>
                <LuSparkles aria-hidden="true" />
                {c.mediaEditAi}
              </legend>
              <label>
                {c.mediaEditPrompt}
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="media-editor__wide media-editor__generate"
                disabled={!prompt.trim() || !canGenerate || !source.width}
                onClick={() => void run('generate')}
              >
                <LuSparkles aria-hidden="true" />
                {c.mediaEditGenerate}
              </button>
              <p className="media-editor__hint">{c.mediaEditAiSizeHint}</p>
            </fieldset>
          </aside>
        )}
      </div>
      {editable && (
        <footer className="media-editor__footer">
          <div className="media-editor__feedback">
            {error ? (
              <p className="media-editor__error" role="alert">
                {error}
              </p>
            ) : busy ? (
              <p role="status">
                <span className="media-editor__spinner" aria-hidden="true" />
                {busy === 'save' ? c.saving : c.mediaEditWorking}
              </p>
            ) : saved ? (
              <p role="status">
                <LuCheck aria-hidden="true" />
                {c.mediaEditSaved}
              </p>
            ) : (
              <p>{c.mediaEditCopyHint}</p>
            )}
          </div>
          {draft && (
            <div className="media-editor__actions">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setDraft(null)
                  setError('')
                }}
              >
                {c.mediaEditDiscard}
              </button>
              <button
                type="button"
                className="media-editor__save"
                disabled={!!busy}
                onClick={() => void run('save')}
              >
                <LuCheck aria-hidden="true" />
                {c.mediaEditSave}
              </button>
            </div>
          )}
        </footer>
      )}
      {!editable && error && (
        <p className="media-editor__error" role="alert">
          {error}
        </p>
      )}
    </dialog>,
    document.body,
  )
}
