import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { PhantasiNoteAuthor } from '../../../types/phantasi'
import type { NoteEditorPane } from './NoteEditorChrome'
import { useEffect, useLayoutEffect } from 'react'
import * as phantasiApi from '../../../services/phantasiApi'
import { userFacingError } from '../../../utils/userFacingError'
import { PHANTASI_MINE_CATEGORY } from '../constants'
import { showNoteNotice } from '../phantasiNotice'
import { collectNoteCategories } from './noteCategory'
import { growTextarea, textareaSupportsFieldSizing } from './noteSelection'

export function useNoteEditorSidecar(host: {
  loadFailed: string
  cloudId: number | null
  settingsOpen: boolean
  loading: boolean
  pane: NoteEditorPane
  title: string
  contentMd: string
  titleInputRef: RefObject<HTMLTextAreaElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setAuthors: Dispatch<SetStateAction<PhantasiNoteAuthor[]>>
  setAuthorCandidates: Dispatch<SetStateAction<PhantasiNoteAuthor[]>>
  setCategoryNames: Dispatch<SetStateAction<string[]>>
}) {
  const {
    loadFailed,
    cloudId,
    settingsOpen,
    loading,
    pane,
    title,
    contentMd,
    titleInputRef,
    textareaRef,
    setAuthors,
    setAuthorCandidates,
    setCategoryNames,
  } = host

  // 标题和写栏都随内容长高，滚动交给整页。能 field-sizing 就让浏览器自己长。
  useLayoutEffect(() => {
    if (loading || textareaSupportsFieldSizing()) return
    growTextarea(titleInputRef.current)
    if (pane === 'write') growTextarea(textareaRef.current)
  }, [contentMd, loading, pane, textareaRef, title, titleInputRef])

  useEffect(() => {
    if (!settingsOpen || cloudId == null) return
    const controller = new AbortController()
    void Promise.all([
      phantasiApi.listNoteDocAuthors(cloudId, controller.signal),
      phantasiApi.listNoteAuthorCandidates(controller.signal),
    ])
      .then(([authors, candidates]) => {
        if (controller.signal.aborted) return
        setAuthors(authors)
        setAuthorCandidates(candidates)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          showNoteNotice(userFacingError(err, loadFailed))
        }
      })
    return () => {
      controller.abort()
    }
  }, [cloudId, loadFailed, setAuthorCandidates, setAuthors, settingsOpen])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      phantasiApi.getCategories(undefined, { signal: controller.signal }).catch(() => []),
      phantasiApi
        .getItemPreviews(
          { category: PHANTASI_MINE_CATEGORY, per_page: 40, sort_order: 'desc' },
          undefined,
          { signal: controller.signal },
        )
        .catch(() => ({ items: [] as Array<{ guid: string; topic?: string | null }> })),
    ]).then(([cats, preview]) => {
      if (controller.signal.aborted) return
      setCategoryNames(
        collectNoteCategories([
          ...cats.map((cat) => ({ topic: cat.name })),
          ...preview.items.filter((item) => item.guid.startsWith('note:')),
        ]),
      )
    })
    return () => controller.abort()
  }, [setCategoryNames])
}
