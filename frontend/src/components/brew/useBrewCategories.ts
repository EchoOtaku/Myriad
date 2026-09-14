/** 工作台分类：目录 + 手记 topic + 订阅 category。预置分类不改。 */

import type {
  BrewCategory,
  BrewNoteDoc,
  BrewSource,
  UpdateSourceRequest,
} from '../../types/brew'
import type { WorkbenchCategoryPage } from './logic/categories'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as brewApi from '../../services/brewApi'
import { userFacingError } from '../../utils/userFacingError'
import {
  canUseCategoryName,
  categoryUsedOnOtherPage,
  collectWorkbenchCategoryPageRows,
  collectWorkbenchCategoryRows,
  formatCategoryFullNotice,
  isLockedCategory,
  normalizeWorkbenchCategoryName,
  removeCategoryPart,
  renameCategoryPart,
  resolveAddCategoryPart,
} from './logic/categories'
import { RequestTurn } from './logic/requestTurn'

async function writeNoteTopic(doc: BrewNoteDoc, topic: string) {
  if (doc.status === 'published' && doc.item_id != null) {
    await brewApi.updateNote(doc.item_id, {
      title: doc.title,
      content_md: doc.content_md,
      topic,
      image: doc.image,
      published_at: doc.published_at ?? undefined,
    })
    return
  }
  await brewApi.updateNoteDoc(doc.id, {
    topic,
    revision: doc.revision,
  })
}

export function useBrewCategories(
  enabled: boolean,
  docs: BrewNoteDoc[],
  sources: BrewSource[],
  labels: {
    loadFailed: string
    createFailed: string
    renameFailed: string
    deleteFailed: string
    assignFailed: string
    categoryFull: string
    untitled: string
  },
  setError: (message: string) => void,
  updateSource: (id: number, data: UpdateSourceRequest) => Promise<void>,
  onNotesRewritten: () => void,
) {
  const [catalog, setCatalog] = useState<BrewCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const turn = useRef(new RequestTurn())
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const docsRef = useRef(docs)
  docsRef.current = docs
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  const loadCatalog = useCallback(async () => {
    if (!enabled) {
      setCatalog([])
      setLoading(false)
      return
    }
    const signal = turn.current.begin()
    setLoading(true)
    try {
      const next = await brewApi.getCategories(undefined, { signal })
      if (!signal.aborted) setCatalog(Array.isArray(next) ? next : [])
    } catch (err) {
      if (signal.aborted) return
      setError(userFacingError(err, labelsRef.current.loadFailed))
      setCatalog([])
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [enabled, setError])

  useEffect(() => {
    void loadCatalog()
    return () => turn.current.cancel()
  }, [loadCatalog])

  const rows = useMemo(
    () => collectWorkbenchCategoryRows(catalog, docs, sources),
    [catalog, docs, sources],
  )
  const noteRows = useMemo(
    () => collectWorkbenchCategoryPageRows(catalog, docs, sources, 'notes'),
    [catalog, docs, sources],
  )
  const sourceRows = useMemo(
    () => collectWorkbenchCategoryPageRows(catalog, docs, sources, 'sources'),
    [catalog, docs, sources],
  )
  const names = useMemo(() => rows.map((row) => row.name), [rows])

  const rewriteNotes = useCallback(
    async (from: string, to: string | null) => {
      let changed = false
      for (const doc of docsRef.current) {
        const next =
          to == null
            ? removeCategoryPart(doc.topic, from)
            : renameCategoryPart(doc.topic, from, to)
        if (next === (doc.topic ?? null)) continue
        changed = true
        await writeNoteTopic(doc, next ?? '')
      }
      if (changed) onNotesRewritten()
    },
    [onNotesRewritten],
  )

  const rewriteSources = useCallback(
    async (from: string, to: string | null) => {
      for (const source of sourcesRef.current) {
        const next =
          to == null
            ? removeCategoryPart(source.category, from)
            : renameCategoryPart(source.category, from, to)
        if (next === (source.category ?? null)) continue
        await updateSource(source.id, { category: next ?? '' })
      }
    },
    [updateSource],
  )

  const assign = useCallback(
    async (page: WorkbenchCategoryPage, ids: readonly number[], raw: string) => {
      const name = normalizeWorkbenchCategoryName(raw)
      if (!name || ids.length === 0) return false
      if (page === 'notes' && isLockedCategory(name)) return false
      setBusy(true)
      try {
        if (page === 'notes') {
          let changed = false
          let fullName: string | null = null
          for (const doc of docsRef.current) {
            if (!ids.includes(doc.id)) continue
            const result = resolveAddCategoryPart(doc.topic, name)
            if (result.kind === 'skip') {
              if (result.reason === 'full' && fullName == null) {
                fullName =
                  doc.title.trim() || labelsRef.current.untitled
              }
              continue
            }
            changed = true
            await writeNoteTopic(doc, result.value)
          }
          if (changed) onNotesRewritten()
          if (fullName) {
            setError(
              formatCategoryFullNotice(
                labelsRef.current.categoryFull,
                fullName,
              ),
            )
          }
        } else {
          let fullName: string | null = null
          for (const source of sourcesRef.current) {
            if (!ids.includes(source.id)) continue
            const result = resolveAddCategoryPart(source.category, name)
            if (result.kind === 'skip') {
              if (result.reason === 'full' && fullName == null) {
                fullName =
                  source.name.trim() || labelsRef.current.untitled
              }
              continue
            }
            await updateSource(source.id, { category: result.value })
          }
          if (fullName) {
            setError(
              formatCategoryFullNotice(
                labelsRef.current.categoryFull,
                fullName,
              ),
            )
          }
        }
        return true
      } catch (err) {
        setError(userFacingError(err, labelsRef.current.assignFailed))
        return false
      } finally {
        setBusy(false)
      }
    },
    [onNotesRewritten, setError, updateSource],
  )

  const create = useCallback(
    async (raw: string) => {
      const name = normalizeWorkbenchCategoryName(raw)
      if (!name || !canUseCategoryName(name, names)) return false
      setBusy(true)
      try {
        await brewApi.createCategory({ name })
        await loadCatalog()
        return true
      } catch (err) {
        setError(userFacingError(err, labelsRef.current.createFailed))
        return false
      } finally {
        setBusy(false)
      }
    },
    [loadCatalog, names, setError],
  )

  const rename = useCallback(
    async (from: string, raw: string, page: WorkbenchCategoryPage) => {
      if (isLockedCategory(from)) return false
      const to = normalizeWorkbenchCategoryName(raw)
      if (!to || to === from) return false
      const taken = names.filter((name) => name !== from)
      if (!canUseCategoryName(to, taken)) return false
      const row = rows.find((item) => item.name === from)
      setBusy(true)
      try {
        if (row?.catalogId != null && !categoryUsedOnOtherPage(row, page)) {
          await brewApi.updateCategory(row.catalogId, { name: to })
        }
        if (page === 'notes') await rewriteNotes(from, to)
        else await rewriteSources(from, to)
        await loadCatalog()
        return true
      } catch (err) {
        setError(userFacingError(err, labelsRef.current.renameFailed))
        return false
      } finally {
        setBusy(false)
      }
    },
    [loadCatalog, names, rewriteNotes, rewriteSources, rows, setError],
  )

  const remove = useCallback(
    async (name: string, page: WorkbenchCategoryPage) => {
      if (isLockedCategory(name)) return false
      const row = rows.find((item) => item.name === name)
      setBusy(true)
      try {
        if (page === 'notes') await rewriteNotes(name, null)
        else await rewriteSources(name, null)
        if (row?.catalogId != null && !categoryUsedOnOtherPage(row, page)) {
          await brewApi.deleteCategory(row.catalogId)
        }
        await loadCatalog()
        return true
      } catch (err) {
        setError(userFacingError(err, labelsRef.current.deleteFailed))
        return false
      } finally {
        setBusy(false)
      }
    },
    [loadCatalog, rewriteNotes, rewriteSources, rows, setError],
  )

  return {
    rows,
    noteRows,
    sourceRows,
    names,
    loading,
    busy,
    create,
    assign,
    rename,
    remove,
    reload: loadCatalog,
  }
}
