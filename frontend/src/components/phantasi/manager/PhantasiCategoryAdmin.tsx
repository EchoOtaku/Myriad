/** 工作台分类管理。皮不进口这一层。笔记页和订阅页各管各的。 */

import type { ReactNode } from 'react'
import type { PhantasiNoteDoc, PhantasiSource } from '../../../types/phantasi'
import type { ManagedListItem } from '../../settings/ManagedList'
import type {
  WorkbenchCategoryPage,
  WorkbenchCategoryRow,
} from '../logic/categories'
import type { WorkbenchNoteOpen } from '../logic/workbench'
import { LuPlus } from '@lib/icons'
import { useCallback, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { InputItem, ManagedList, SettingsButton } from '../../settings'
import { getIconUrl, getImageUrl, isFriendLinkCategory, isMineCategory } from '../constants'
import { sourceMatchesCategory } from '../logic/board'
import {
  canUseCategoryName,
  noteMatchesCategory,
  normalizeWorkbenchCategoryName,
} from '../logic/categories'
import {
  workbenchNoteCover,
  workbenchNoteListExcerpt,
  workbenchNoteOpen,
  workbenchNoteStatusKey,
} from '../logic/workbench'

export function PhantasiCategoryAdmin({
  page,
  query: queryProp,
  rows,
  sources = [],
  notes = [],
  openName = null,
  loading,
  busy,
  onCreate,
  onRename,
  onDelete,
  onOpen,
  onOpenNote,
}: {
  page: WorkbenchCategoryPage
  query?: string
  rows: WorkbenchCategoryRow[]
  sources?: readonly PhantasiSource[]
  notes?: readonly PhantasiNoteDoc[]
  openName?: string | null
  loading: boolean
  busy: boolean
  onCreate: (name: string) => Promise<boolean>
  onRename: (from: string, to: string) => Promise<boolean>
  onDelete: (name: string) => Promise<boolean>
  onOpen?: (name: string | null) => void
  onOpenNote?: (open: WorkbenchNoteOpen) => void
}) {
  const { t, format } = useI18n()
  const phantasi = t.phantasi
  const query = queryProp ?? ''
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const displayName = (name: string) => {
    if (isFriendLinkCategory(name)) return phantasi.friendLinks
    if (isMineCategory(name)) return phantasi.me
    return name
  }

  const nextName = normalizeWorkbenchCategoryName(draft)
  const canCreate = canUseCategoryName(
    nextName ?? '',
    rows.map((row) => row.name),
  )
  const takenExceptEditing = rows
    .filter((row) => row.name !== editing)
    .map((row) => row.name)
  const renameName = normalizeWorkbenchCategoryName(renameDraft)
  const canRename =
    editing != null &&
    renameName != null &&
    renameName !== editing &&
    canUseCategoryName(renameName, takenExceptEditing)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) => {
      const label = displayName(row.name)
      return (
        row.name.toLowerCase().includes(needle) ||
        label.toLowerCase().includes(needle)
      )
    })
  }, [phantasi.friendLinks, phantasi.me, query, rows])

  const submitCreate = useCallback(() => {
    if (!canCreate || !nextName) return
    void onCreate(nextName).then((ok) => {
      if (ok) setDraft('')
    })
  }, [canCreate, nextName, onCreate])

  const openRow = visible.find((row) => row.name === openName) ?? null
  const sourceMembers = useMemo(
    () =>
      page === 'sources' && openName
        ? sources.filter((source) => sourceMatchesCategory(source, openName))
        : [],
    [openName, page, sources],
  )
  const noteMembers = useMemo(
    () =>
      page === 'notes' && openName
        ? notes.filter((note) => noteMatchesCategory(note, openName))
        : [],
    [notes, openName, page],
  )

  const categoryItems = useMemo<ManagedListItem[]>(
    () => [
      {
        id: '__new__',
        className: 'phantasi-workbench__category-new',
        title: phantasi.noteCategoryNew,
        leading: (
          <span className="phantasi-workbench__category-new-mark" aria-hidden>
            <LuPlus size={16} />
          </span>
        ),
        trailing: (
          <form
            className="phantasi-workbench__category-new-compose"
            onSubmit={(event) => {
              event.preventDefault()
              submitCreate()
            }}
          >
            <input
              className="phantasi-workbench__category-new-input"
              value={draft}
              placeholder={phantasi.inputNewCategory}
              aria-label={phantasi.noteCategoryNew}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
            <SettingsButton
              type="submit"
              variant={canCreate ? 'primary' : 'secondary'}
              size="sm"
              disabled={!canCreate || busy}
              loading={busy}
            >
              {phantasi.add}
            </SettingsButton>
          </form>
        ),
      },
      ...visible.map((row) => {
        const label = displayName(row.name)
        return {
          id: row.name,
          title: label,
          subtitle:
            page === 'notes'
              ? format(phantasi.workbenchCategoryNoteUsage, {
                  notes: row.noteCount,
                })
              : format(phantasi.workbenchCategorySourceUsage, {
                  sources: row.sourceCount,
                }),
          badge: row.locked
            ? { label: phantasi.workbenchCategoryLocked, tone: 'muted' as const }
            : undefined,
          renderHit: ({ leading, main }: { leading: ReactNode; main: ReactNode }) => (
            <button
              type="button"
              className="managed-list-row-hit"
              disabled={busy}
              onClick={() => onOpen?.(row.name)}
            >
              {leading}
              {main}
            </button>
          ),
          busy,
          actions: row.locked
            ? []
            : [
                {
                  key: 'rename',
                  label: phantasi.workbenchCategoryRename,
                  disabled: busy,
                  onClick: () => {
                    setEditing((current) => {
                      if (current === row.name) return null
                      setRenameDraft(row.name)
                      return row.name
                    })
                  },
                },
                {
                  key: 'delete',
                  label: phantasi.delete,
                  variant: 'danger' as const,
                  confirm: format(
                    page === 'notes'
                      ? phantasi.workbenchCategoryDeleteNotesConfirm
                      : phantasi.workbenchCategoryDeleteSourcesConfirm,
                    { name: label },
                  ),
                  disabled: busy,
                  onClick: () => {
                    void onDelete(row.name).then((ok) => {
                      if (ok) {
                        setEditing((current) =>
                          current === row.name ? null : current,
                        )
                        if (openName === row.name) onOpen?.(null)
                      }
                    })
                  },
                },
              ],
        }
      }),
    ],
    [
      busy,
      canCreate,
      draft,
      format,
      onDelete,
      onOpen,
      openName,
      page,
      phantasi,
      submitCreate,
      visible,
    ],
  )

  const memberItems = useMemo<ManagedListItem[]>(() => {
    if (page === 'notes') {
      return noteMembers.map((doc) => {
        const excerpt = workbenchNoteListExcerpt(doc)
        const cover = getImageUrl(workbenchNoteCover(doc))
        return {
          id: doc.id,
          title: doc.title.trim() || phantasi.workbenchNoteUntitled,
          subtitle: excerpt || undefined,
          badge: {
            label: phantasi[workbenchNoteStatusKey(doc)],
            tone: 'muted' as const,
          },
          leading: cover ? (
            <img className="phantasi-workbench__thumb" src={cover} alt="" />
          ) : undefined,
          renderHit: ({
            leading,
            main,
          }: {
            leading: ReactNode
            main: ReactNode
          }) => (
            <button
              type="button"
              className="managed-list-row-hit"
              disabled={busy}
              onClick={() => onOpenNote?.(workbenchNoteOpen(doc))}
            >
              {leading}
              {main}
            </button>
          ),
        }
      })
    }
    return sourceMembers.map((source) => {
      const icon = getIconUrl(source.icon)
      return {
        id: source.id,
        title: source.name,
        subtitle: source.url,
        leading: icon ? (
          <img className="phantasi-workbench__thumb" src={icon} alt="" />
        ) : undefined,
      }
    })
  }, [
    busy,
    noteMembers,
    onOpenNote,
    page,
    phantasi,
    sourceMembers,
  ])

  return (
    <div
      id={
        page === 'notes'
          ? 'workbench-note-categories'
          : 'workbench-source-categories'
      }
    >
      {openRow ? (
        <ManagedList
          queryCollapsible={false}
          queryChrome="plain"
          loading={false}
          working={busy}
          items={memberItems}
          emptyText={phantasi.noContent}
          maxHeight={null}
        />
      ) : (
        <>
          {editing && !visible.find((row) => row.name === editing)?.locked ? (
            <div className="phantasi-add-form">
              <InputItem
                itemKey={`category-rename-${editing}`}
                label={phantasi.workbenchCategoryRename}
                value={renameDraft}
                onChange={setRenameDraft}
                size="sm"
                layout="vertical"
                autoComplete="off"
                disabled={busy}
              />
              <SettingsButton
                variant="primary"
                size="sm"
                disabled={!canRename || busy}
                loading={busy}
                onClick={() => {
                  if (!renameName || !editing) return
                  void onRename(editing, renameName).then((ok) => {
                    if (ok) setEditing(null)
                  })
                }}
              >
                {phantasi.save}
              </SettingsButton>
            </div>
          ) : null}
          <ManagedList
            queryCollapsible={false}
            queryChrome="plain"
            loading={loading && visible.length === 0}
            working={busy}
            items={categoryItems}
            emptyText={
              visible.length === 0 && !query.trim()
                ? phantasi.workbenchCategoryEmpty
                : phantasi.workbenchCategoryKindEmpty
            }
            maxHeight={null}
          />
        </>
      )}
    </div>
  )
}
