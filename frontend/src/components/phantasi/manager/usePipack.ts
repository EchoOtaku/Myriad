import type { ChangeEvent } from 'react'
import type { PhantasiSource } from '../../../types/phantasi'
import type { ImportProgress } from './modes'
import type { PipackCopy } from './pipackIo'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { showError, showSuccess } from '../../../utils/toastManager'
import { userFacingError } from '../../../utils/userFacingError'
import { RequestTurn, unlessAborted } from '../logic/requestTurn'
import {
  exportOpmlFile,
  exportPipackFile,
  importPipackFile,
} from './pipackIo'

function pipackCopyFrom(phantasi: {
  exportSuccess: string
  errorExportFailed: string
  importStepReading: string
  importStepUnzipping: string
  importStepParsing: string
  importStepImporting: string
  errorInvalidFormat: string
  importSuccess: string
  errorImportFailed: string
}): PipackCopy {
  return {
    exportSuccess: phantasi.exportSuccess,
    errorExportFailed: phantasi.errorExportFailed,
    importStepReading: phantasi.importStepReading,
    importStepUnzipping: phantasi.importStepUnzipping,
    importStepParsing: phantasi.importStepParsing,
    importStepImporting: phantasi.importStepImporting,
    errorInvalidFormat: phantasi.errorInvalidFormat,
    importSuccess: phantasi.importSuccess,
    errorImportFailed: phantasi.errorImportFailed,
  }
}

export function usePipack(
  sources: PhantasiSource[],
  onSourcesChange: (() => void) | undefined,
) {
  const { t } = useI18n()
  const copyRef = useRef<PipackCopy>(pipackCopyFrom(t.phantasi))
  copyRef.current = pipackCopyFrom(t.phantasi)

  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const turns = useRef(new RequestTurn())

  useEffect(
    () => () => {
      turns.current.cancel()
    },
    [],
  )

  const exportPack = useCallback(async () => {
    const signal = turns.current.begin()
    setLoading(true)
    const result = await exportPipackFile(sources, copyRef.current, signal)
    if (signal.aborted) {
      setLoading(false)
      return
    }
    if (result.ok) showSuccess(result.message)
    else showError(result.error)
    setLoading(false)
  }, [sources])

  const importFromFile = useCallback(
    async (file: File) => {
      const signal = turns.current.begin()
      setLoading(true)
      const result = await importPipackFile(
        file,
        sources,
        copyRef.current,
        (next) => {
          unlessAborted(signal, () => setProgress(next))
        },
        signal,
      )
      if (signal.aborted) {
        if (result.ok) onSourcesChange?.()
        setLoading(false)
        setProgress(null)
        if (inputRef.current) inputRef.current.value = ''
        return
      }
      if (result.ok) {
        showSuccess(result.message)
        onSourcesChange?.()
      } else {
        showError(result.error)
      }
      setLoading(false)
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    },
    [sources, onSourcesChange],
  )

  const importFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) await importFromFile(file)
    },
    [importFromFile],
  )

  const exportOpml = useCallback(() => {
    const signal = turns.current.begin()
    void exportOpmlFile(signal).catch((err) => {
      if (signal.aborted) return
      console.error('OPML export failed:', err)
      showError(userFacingError(err, copyRef.current.errorExportFailed))
    })
  }, [])

  return {
    loading,
    progress,
    inputRef,
    exportPack,
    importFile,
    importFromFile,
    exportOpml,
  }
}
