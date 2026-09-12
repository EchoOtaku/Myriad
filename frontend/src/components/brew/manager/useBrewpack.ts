import type { ChangeEvent } from 'react'
import type { BrewSource } from '../../../types/brew'
import type { BrewpackCopy } from './brewpackIo'
import type { ImportProgress } from './modes'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { showError, showSuccess } from '../../../utils/toastManager'
import { userFacingError } from '../../../utils/userFacingError'
import { RequestTurn, unlessAborted } from '../logic/requestTurn'
import {
  exportBrewpackFile,
  exportOpmlFile,
  importBrewpackFile,
} from './brewpackIo'

function brewpackCopyFrom(brew: {
  exportSuccess: string
  errorExportFailed: string
  importStepReading: string
  importStepUnzipping: string
  importStepParsing: string
  importStepImporting: string
  errorInvalidFormat: string
  importSuccess: string
  errorImportFailed: string
}): BrewpackCopy {
  return {
    exportSuccess: brew.exportSuccess,
    errorExportFailed: brew.errorExportFailed,
    importStepReading: brew.importStepReading,
    importStepUnzipping: brew.importStepUnzipping,
    importStepParsing: brew.importStepParsing,
    importStepImporting: brew.importStepImporting,
    errorInvalidFormat: brew.errorInvalidFormat,
    importSuccess: brew.importSuccess,
    errorImportFailed: brew.errorImportFailed,
  }
}

export function useBrewpack(
  sources: BrewSource[],
  onSourcesChange: (() => void) | undefined,
) {
  const { t } = useI18n()
  const copyRef = useRef<BrewpackCopy>(brewpackCopyFrom(t.brew))
  copyRef.current = brewpackCopyFrom(t.brew)

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
    const result = await exportBrewpackFile(sources, copyRef.current, signal)
    unlessAborted(signal, () => {
      if (result.ok) showSuccess(result.message)
      else showError(result.error)
      setLoading(false)
    })
  }, [sources])

  const importFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      const signal = turns.current.begin()
      setLoading(true)
      const result = await importBrewpackFile(
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
        return
      }
      if (result.ok) {
        showSuccess(result.message)
        onSourcesChange?.()
      } else {
        showError(result.error)
      }
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    },
    [sources, onSourcesChange],
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
    exportOpml,
  }
}
