import type { ReactNode } from 'react'
import type { CommentItem } from '../../../types/phantasi'
import type { ManagedListItem } from '../../settings/ManagedList'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { InputItem, ManagedList } from '../../settings'
import { filterWorkbenchComments } from '../logic/workbench'
import { noteScheduleLabel } from '../notes/noteBoard'
import { PhantasiWorkbenchIcon } from '../ui/PhantasiWorkbenchIcon'
import { listSelectChrome, useListSelection } from '../useListSelection'
import { WorkbenchPage } from './PhantasiWorkbenchChrome'

export function WorkbenchCommentsPane({
  active,
  back,
  comments,
  commentsLoading,
  busy,
  guide,
  guidePath,
  onDeleteComments,
  onOpenCommentItem,
}: {
  active: boolean
  back: ReactNode
  comments: CommentItem[]
  commentsLoading: boolean
  busy: boolean
  guide?: ReactNode
  guidePath?: string
  onDeleteComments?: (ids: number[]) => void
  onOpenCommentItem?: (itemId: number) => void
}) {
  const { t, locale, format } = useI18n()
  const phantasi = t.phantasi
  const [commentQuery, setCommentQuery] = useState('')
  const visibleComments = useMemo(
    () => filterWorkbenchComments(comments, commentQuery),
    [commentQuery, comments],
  )
  const commentIds = useMemo(
    () => visibleComments.map((row) => row.id),
    [visibleComments],
  )
  const commentsSelect = useListSelection(commentIds)
  useEffect(() => {
    if (!active) commentsSelect.exit()
  }, [active, commentsSelect.exit])
  const commentsSelectBar = listSelectChrome({
    selecting: commentsSelect.selecting,
    picked: commentsSelect.picked,
    total: commentsSelect.total,
    allOn: commentsSelect.allOn,
    busy,
    labels: {
      edit: phantasi.edit,
      selectAll: phantasi.selectAll,
      deselectAll: phantasi.deselectAll,
      deleteSelected: phantasi.deleteSelected,
      deleteConfirm: format(phantasi.workbenchDeleteSelectedCommentsConfirm, {
        count: commentsSelect.picked,
      }),
      exitEdit: phantasi.exitEdit,
      selectedLabel: phantasi.editMode,
    },
    onEnter: commentsSelect.enter,
    onExit: commentsSelect.exit,
    onSelectAll: commentsSelect.selectAll,
    onDelete: () => {
      const ids = visibleComments
        .filter((row) => commentsSelect.selected.has(row.id))
        .map((row) => row.id)
      if (ids.length === 0) return
      commentsSelect.exit()
      onDeleteComments?.(ids)
    },
  })

  const commentItems = useMemo<ManagedListItem[]>(
    () =>
      visibleComments.map((row) => {
        const picking = commentsSelect.selecting
        const author =
          row.user_display_name || row.user_name || phantasi.anonymousUser
        const when = noteScheduleLabel(row.created_at, locale)
        const title = row.comment.trim() || row.selected_text.trim() || author
        return {
          id: row.id,
          title,
          subtitle: [row.item_title, author, when].filter(Boolean).join(' · '),
          meta: row.selected_text.trim() || row.source_name || undefined,
          selected: commentsSelect.selected.has(row.id),
          onSelect: picking ? () => commentsSelect.toggle(row.id) : undefined,
          onClick: picking
            ? () => commentsSelect.toggle(row.id)
            : () => onOpenCommentItem?.(row.item_id),
          actions: picking
            ? []
            : [
                {
                  key: 'open',
                  label: phantasi.workbenchCommentOpen,
                  onClick: () => onOpenCommentItem?.(row.item_id),
                },
                {
                  key: 'delete',
                  label: phantasi.delete,
                  variant: 'danger' as const,
                  confirm: phantasi.workbenchDeleteCommentConfirm,
                  onClick: () => onDeleteComments?.([row.id]),
                  disabled: busy,
                },
              ],
        }
      }),
    [
      busy,
      commentsSelect.selecting,
      commentsSelect.selected,
      commentsSelect.toggle,
      locale,
      onDeleteComments,
      onOpenCommentItem,
      phantasi,
      visibleComments,
    ],
  )

  if (!active) return null

  return (
    <WorkbenchPage
      title={phantasi.workbenchComments}
      icon={<PhantasiWorkbenchIcon kind="comments" />}
      back={back}
      guide={guide}
      guidePath={guidePath}
      search={
        <InputItem
          itemKey="workbench-comment-search"
          label={phantasi.workbenchSearchComments}
          value={commentQuery}
          onChange={setCommentQuery}
          placeholder={phantasi.workbenchSearchComments}
          inputType="search"
          size="sm"
          layout="vertical"
          autoComplete="off"
          className="phantasi-workbench__title-search"
        />
      }
    >
      <ManagedList
        stats={commentsSelectBar.stats}
        toolbar={commentsSelectBar.toolbar}
        toolbarPlacement="filters"
        queryCollapsible={false}
        queryChrome="plain"
        loading={commentsLoading && comments.length === 0}
        working={busy}
        items={commentItems}
        emptyText={
          comments.length === 0
            ? phantasi.workbenchCommentEmpty
            : phantasi.workbenchCommentKindEmpty
        }
        maxHeight={null}
      />
    </WorkbenchPage>
  )
}
