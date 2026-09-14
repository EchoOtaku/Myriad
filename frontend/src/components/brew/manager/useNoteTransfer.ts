import type { BrewNoteDoc } from '../../../types/brew'
import type { ContentIoCopy } from './contentIo/contentIo'
import type { NoteTransferKind } from './contentIo/types'
import type { ImportProgress } from './modes'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { showError, showSuccess } from '../../../utils/toastManager'
import { RequestTurn, unlessAborted } from '../logic/requestTurn'
import { exportTransferFile, importTransferFile } from './contentIo/contentIo'

function copyFrom(brew: {
  workbenchContentExportSuccess: string
  errorExportFailed: string
  importStepReading: string
  importStepParsing: string
  importStepImporting: string
  errorInvalidFormat: string
  importSuccess: string
  errorImportFailed: string
  workbenchNoteUntitled: string
  workbenchNotes: string
}): ContentIoCopy {
  return {
    exportSuccess: brew.workbenchContentExportSuccess,
    errorExportFailed: brew.errorExportFailed,
    importStepReading: brew.importStepReading,
    importStepParsing: brew.importStepParsing,
    importStepImporting: brew.importStepImporting,
    errorInvalidFormat: brew.errorInvalidFormat,
    importSuccess: brew.importSuccess,
    errorImportFailed: brew.errorImportFailed,
    untitled: brew.workbenchNoteUntitled,
    siteTitle: brew.workbenchNotes,
  }
}

export function useNoteTransfer(
  docs: readonly BrewNoteDoc[],
  onImported?: () => void,
) {
  const { t } = useI18n()
  const copyRef = useRef<ContentIoCopy>(copyFrom(t.brew))
  copyRef.current = copyFrom(t.brew)

  const [loading, setLoading] = useState(false)
  const [activeKind, setActiveKind] = useState<NoteTransferKind | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const turns = useRef(new RequestTurn())

  useEffect(
    () => () => {
      turns.current.cancel()
    },
    [],
  )

  const exportKind = useCallback(
    async (kind: NoteTransferKind) => {
      const signal = turns.current.begin()
      setActiveKind(kind)
      setLoading(true)
      const result = await exportTransferFile(
        kind,
        docs,
        copyRef.current,
        signal,
      )
      if (signal.aborted) {
        setLoading(false)
        setActiveKind(null)
        return
      }
      if (result.ok) showSuccess(result.message)
      else showError(result.error)
      setLoading(false)
      setActiveKind(null)
    },
    [docs],
  )

  const importKind = useCallback(
    async (kind: NoteTransferKind, file: File) => {
      const signal = turns.current.begin()
      setActiveKind(kind)
      setLoading(true)
      const result = await importTransferFile(
        kind,
        file,
        copyRef.current,
        (next) => {
          unlessAborted(signal, () => setProgress(next))
        },
        signal,
      )
      if (signal.aborted) {
        if (result.ok) onImported?.()
        setLoading(false)
        setActiveKind(null)
        setProgress(null)
        return
      }
      if (result.ok) {
        showSuccess(result.message)
        onImported?.()
      } else {
        showError(result.error)
      }
      setLoading(false)
      setActiveKind(null)
      setProgress(null)
    },
    [onImported],
  )

  return {
    loading,
    activeKind,
    progress,
    exportKind,
    importKind,
  }
}
