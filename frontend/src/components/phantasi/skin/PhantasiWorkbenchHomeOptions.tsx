import type { PhantasiWorkbenchIconKind } from '../ui/PhantasiWorkbenchIcon'
import { LuEye } from '@lib/icons'
import { SegmentedControl, SettingGroup, SettingGroupGrid } from '../../settings'
import {
  WORKBENCH_RAIL_OPTION_PANES,
  type WorkbenchRailOptionPane,
  type WorkbenchRailVisibility,
  workbenchRailAllowsHide,
} from '../logic/workbenchVisibility'
import { PhantasiWorkbenchIcon } from '../ui/PhantasiWorkbenchIcon'

const PANE_CARDS: Record<
  WorkbenchRailOptionPane,
  { label: WorkbenchRailOptionLabel; icon: PhantasiWorkbenchIconKind }
> = {
  notes: { label: 'workbenchNotes', icon: 'notes' },
  comments: { label: 'workbenchComments', icon: 'comments' },
  media: { label: 'workbenchMedia', icon: 'media' },
  notesIo: { label: 'workbenchNotesTransfer', icon: 'notes-transfer' },
  sources: { label: 'workbenchSources', icon: 'sources' },
  reviews: { label: 'workbenchReviews', icon: 'reviews' },
  rsshub: { label: 'workbenchRsshub', icon: 'rsshub' },
  feedsIo: { label: 'workbenchFeedsTransfer', icon: 'feeds-transfer' },
}

export type WorkbenchRailOptionLabel =
  | 'workbenchNotes'
  | 'workbenchComments'
  | 'workbenchMedia'
  | 'workbenchNotesTransfer'
  | 'workbenchSources'
  | 'workbenchReviews'
  | 'workbenchRsshub'
  | 'workbenchFeedsTransfer'

export function WorkbenchHomeOptions({
  visibility,
  copy,
  onChange,
}: {
  visibility: WorkbenchRailVisibility
  copy: {
    workbenchHomeOptions: string
    workbenchRailVisibilityTitle: string
    workbenchRailVisibilityDesc: string
    workbenchRailShow: string
    workbenchRailHide: string
  } & Record<WorkbenchRailOptionLabel, string>
  onChange: (pane: WorkbenchRailOptionPane, visible: boolean) => void
}) {
  return (
    <section
      className="phantasi-workbench__home-options"
      aria-label={copy.workbenchHomeOptions}
    >
      <h3>{copy.workbenchHomeOptions}</h3>
      <SettingGroup
        toc={false}
        title={copy.workbenchRailVisibilityTitle}
        description={copy.workbenchRailVisibilityDesc}
        descriptionVisible
        icon={<LuEye size={15} />}
      >
        <SettingGroupGrid
          columns={2}
          variant="card"
          align="stretch"
          minColumnWidth="16rem"
          ariaLabel={copy.workbenchRailVisibilityTitle}
        >
          {WORKBENCH_RAIL_OPTION_PANES.map((pane) => {
            const card = PANE_CARDS[pane]
            const visible = visibility[pane]
            const canHide = workbenchRailAllowsHide(visibility, pane)
            return (
              <SettingGroup
                key={pane}
                toc={false}
                title={copy[card.label]}
                icon={<PhantasiWorkbenchIcon kind={card.icon} />}
              >
                <SegmentedControl
                  size="sm"
                  columns={2}
                  value={visible ? 'show' : 'hide'}
                  options={[
                    { value: 'show', label: copy.workbenchRailShow },
                    {
                      value: 'hide',
                      label: copy.workbenchRailHide,
                      disabled: visible && !canHide,
                    },
                  ]}
                  onChange={(next) => onChange(pane, next === 'show')}
                  ariaLabel={copy[card.label]}
                />
              </SettingGroup>
            )
          })}
        </SettingGroupGrid>
      </SettingGroup>
    </section>
  )
}
