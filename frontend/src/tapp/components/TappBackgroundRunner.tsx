import type { TappCodeStructure, TappInstance } from '../types'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { getTappRuntime } from '../runtime'
import { loadCoreResources } from '../runtime/sandbox/resourceLoader'
import { TappPageSandbox } from '../runtime/TappPageSandbox'

export const TappBackgroundRunner: React.FC = () => {
  const { t } = useI18n()
  const disabledRef = useRef(new Set<string>())
  const mountedRef = useRef(false)
  const [backgroundTapps, setBackgroundTapps] = useState<TappInstance[]>([])
  const [tappCodes, setTappCodes] = useState<Map<string, TappCodeStructure>>(
    new Map(),
  )
  const loadingRef = useRef(false)
  const reloadPendingRef = useRef(false)
  const runtime = getTappRuntime()

  const loadBackgroundTapps = useCallback(async (): Promise<void> => {
    // 合并并发加载，但不丢加载期间的 start/stop/background 变化。
    if (loadingRef.current) {
      reloadPendingRef.current = true
      return
    }
    loadingRef.current = true

    try {
      await runtime.waitForSync()

      if (!mountedRef.current) return
      const tappsToRun = runtime.getBackgroundTapps().filter(tapp => !disabledRef.current.has(tapp.id))

      const codes = new Map<string, TappCodeStructure>()
      for (const tapp of tappsToRun) {
        if (codes.size >= 4) break
        if (!mountedRef.current || reloadPendingRef.current) return
        try {
          // 后台只加载 core，不生成 Page HTML/CSS。
          const resources = await loadCoreResources(tapp)

          const code: TappCodeStructure = {
            modules: resources.modules,
            moduleResolutions: resources.moduleResolutions,
            coreEntry: resources.coreEntry,
            i18n: resources.i18n,
          }

          codes.set(tapp.id, code)
        } catch (error) {
          console.error(
            `[TappBackgroundRunner] Failed to load code for Tapp ${tapp.id}:`,
            error,
          )
        }
      }

      if (!mountedRef.current || reloadPendingRef.current) return
      setBackgroundTapps(tappsToRun.filter(tapp => codes.has(tapp.id)))
      setTappCodes(codes)
    } catch (error) {
      console.error(
        '[TappBackgroundRunner] Failed to load background Tapps:',
        error,
      )
    } finally {
      loadingRef.current = false
      if (mountedRef.current && reloadPendingRef.current) {
        reloadPendingRef.current = false
        void loadBackgroundTapps()
      }
    }
  }, [runtime])

  useEffect(() => {
    mountedRef.current = true
    loadBackgroundTapps()
    return () => { mountedRef.current = false }
  }, [loadBackgroundTapps])

  useEffect(() => {
    const handleTappEvent = () => {
      // Remove revoked / uninstalled instances immediately, before awaiting code.
      const allowed = runtime.getBackgroundTapps().filter(tapp => !disabledRef.current.has(tapp.id))
      setBackgroundTapps(current => current.flatMap(tapp => {
        const next = allowed.find(candidate => candidate.id === tapp.id)
        return next ? [next] : []
      }))
      loadBackgroundTapps()
    }

    const handleSubjectChanged = () => {
      disabledRef.current.clear()
      setBackgroundTapps([])
      setTappCodes(new Map())
      loadBackgroundTapps()
    }
    window.addEventListener('tapp-subject-ready', handleSubjectChanged)
    const unsubStarted = runtime.on('tapp:started', handleTappEvent)
    const unsubStopped = runtime.on('tapp:stopped', handleTappEvent)
    const unsubInstalled = runtime.on('tapp:installed', handleTappEvent)
    const unsubUninstalled = runtime.on('tapp:uninstalled', handleTappEvent)
    const unsubUpdated = runtime.on('tapp:updated', handleTappEvent)
    const unsubSync = runtime.on('sync:complete', handleTappEvent)
    const unsubBackground = runtime.on('background:changed', handleTappEvent)

    return () => {
      window.removeEventListener('tapp-subject-ready', handleSubjectChanged)
      unsubStarted()
      unsubStopped()
      unsubInstalled()
      unsubUninstalled()
      unsubUpdated()
      unsubSync()
      unsubBackground()
    }
  }, [runtime, loadBackgroundTapps])

  // A visible escape hatch accompanies the bounded headless surfaces.
  return (
    <>
      {backgroundTapps.length > 0 && (
        <details className="fixed bottom-4 right-4 z-50 rounded-lg bg-[var(--color-bg)] p-2 shadow">
          <summary>{t.tapp.apps} · {t.tapp.running} ({backgroundTapps.length})</summary>
          {backgroundTapps.map(tapp => (
            <div key={tapp.id} className="flex items-center gap-3 p-2">
              <span>{tapp.manifest.name}</span>
              <button
                type="button"
                onClick={() => {
                  disabledRef.current.add(tapp.id)
                  setBackgroundTapps(current => current.filter(item => item.id !== tapp.id))
                  void loadBackgroundTapps()
                }}
              >{t.tapp.stop}</button>
            </div>
          ))}
        </details>
      )}
      <div
        className="fixed top-0 left-0 w-0 h-0 overflow-hidden invisible pointer-events-none"
        aria-hidden="true"
      >
        {backgroundTapps.map((tapp) => {
          const code = tappCodes.get(tapp.id)
          if (!code) return null

          return (
            <TappPageSandbox
              key={`${tapp.id}:${tapp.manifest.version}`}
              tappInstance={tapp}
              code={code}
              headless
              onError={(error) => {
                console.error(
                  `[TappBackgroundRunner] Tapp ${tapp.id} error:`,
                  error,
                )
              }}
              className="w-px h-px"
            />
          )
        })}
      </div>
    </>
  )
}

export default TappBackgroundRunner
