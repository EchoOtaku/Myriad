/** 工作台分类管理。皮不进口这一层。笔记页和订阅页各管各的。 */

import type { ManagedListItem } from '../../settings/ManagedList'
import type {
  WorkbenchCategoryPage,
  WorkbenchCategoryRow,
} from '../logic/categories'
import { LuPlus } from '@lib/icons'
import { useCallback, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { InputItem, ManagedList, SettingsButton } from '../../settings'
import { isFriendLinkCategory, isMineCategory } from '../constants'
import {
  canUseCategoryName,
  normalizeWorkbenchCategoryName,
} from '../logic/categories'

export function PhantasiCategoryAdmin({
  page,
  query: queryProp,
  rows,
  loading,
  busy,
  onCreate,
  onRename,
  onDelete,
}: {
  page: WorkbenchCategoryPage
  query?: string
  rows: WorkbenchCategoryRow[]
  loading: boolean
  busy: boolean
  onCreate: (name: string) => Promise<boolean>
  onRename: (from: string, to: string) => Promise<boolean>
  onDelete: (name: string) => Promise<boolean>
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

  const items = useMemo<ManagedListItem[]>(
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
        const open = editing === row.name
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
          expanded: open,
          onToggleExpand: row.locked
            ? undefined
            : () => {
                setEditing((current) => {
                  if (current === row.name) return null
                  setRenameDraft(row.name)
                  return row.name
                })
              },
          expandContent:
            open && !row.locked ? (
              <div className="phantasi-add-form">
                <InputItem
                  itemKey={`category-rename-${row.name}`}
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
                    if (!renameName) return
                    void onRename(row.name, renameName).then((ok) => {
                      if (ok) setEditing(null)
                    })
                  }}
                >
                  {phantasi.save}
                </SettingsButton>
              </div>
            ) : null,
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
                      }
                    })
                  },
                },
              ],
        }
      }),
    ],
    [
      phantasi,
      busy,
      canCreate,
      canRename,
      draft,
      editing,
      format,
      onDelete,
      onRename,
      page,
      renameDraft,
      renameName,
      submitCreate,
      visible,
    ],
  )

  return (
    <div
      id={
        page === 'notes'
          ? 'workbench-note-categories'
          : 'workbench-source-categories'
      }
    >
      <ManagedList
        queryCollapsible={false}
        queryChrome="plain"
        loading={loading && visible.length === 0}
        working={busy}
        items={items}
        emptyText={
          visible.length === 0 && !query.trim()
            ? phantasi.workbenchCategoryEmpty
            : phantasi.workbenchCategoryKindEmpty
        }
        maxHeight={null}
      />
    </div>
  )
}
