import type { PhantasiNoteAuthor } from '../../../types/phantasi'
import { useCallback, useMemo, useState } from 'react'
import * as phantasiApi from '../../../services/phantasiApi'
import { userFacingError } from '../../../utils/userFacingError'
import { workbenchAuthorLabel, workbenchNoteAuthorName } from '../logic/workbench'
import { showNoteNotice } from '../phantasiNotice'

export function useNoteEditorAuthors(
  cloudId: number | null,
  labels: { addFailed: string; removeFailed: string },
) {
  const [authors, setAuthors] = useState<PhantasiNoteAuthor[]>([])
  const [authorCandidates, setAuthorCandidates] = useState<PhantasiNoteAuthor[]>(
    [],
  )
  const [authorBusy, setAuthorBusy] = useState(false)

  const authorLine = useMemo(
    () => workbenchNoteAuthorName({ authors }, '') || null,
    [authors],
  )
  const authorChips = useMemo(
    () =>
      authors.map((author) => ({
        user_id: author.user_id,
        label: workbenchAuthorLabel(author, String(author.user_id)),
        owner: author.role === 'owner',
      })),
    [authors],
  )
  const addableAuthors = useMemo(
    () =>
      authorCandidates
        .filter(
          (candidate) =>
            !authors.some((author) => author.user_id === candidate.user_id),
        )
        .map((candidate) => ({
          value: String(candidate.user_id),
          label: workbenchAuthorLabel(candidate, String(candidate.user_id)),
        })),
    [authorCandidates, authors],
  )

  const handleAddAuthor = useCallback(
    async (userId: number) => {
      if (cloudId == null || authorBusy) return
      setAuthorBusy(true)
      try {
        setAuthors(await phantasiApi.addNoteAuthor(cloudId, userId))
      } catch (err) {
        showNoteNotice(userFacingError(err, labels.addFailed))
      } finally {
        setAuthorBusy(false)
      }
    },
    [authorBusy, cloudId, labels.addFailed],
  )

  const handleRemoveAuthor = useCallback(
    async (userId: number) => {
      if (cloudId == null || authorBusy) return
      setAuthorBusy(true)
      try {
        setAuthors(await phantasiApi.removeNoteAuthor(cloudId, userId))
      } catch (err) {
        showNoteNotice(userFacingError(err, labels.removeFailed))
      } finally {
        setAuthorBusy(false)
      }
    },
    [authorBusy, cloudId, labels.removeFailed],
  )

  return {
    authors,
    setAuthors,
    authorCandidates,
    setAuthorCandidates,
    authorBusy,
    authorLine,
    authorChips,
    addableAuthors,
    handleAddAuthor,
    handleRemoveAuthor,
  }
}
