import { useState } from 'react'
import {
  LuEye,
  LuInbox,
  LuLink,
  LuNotebookPen,
  LuStar,
} from '@lib/icons'
import { useI18n } from '../../../contexts/I18nContext'
import {
  type ModuleVisibilityLevel,
  useModuleVisibilityPreferences,
} from '../../../utils/moduleVisibility'
import { SegmentedControl, SettingGroup, SettingGroupGrid } from '../../settings'
import {
  JOURNAL_BOARD_NAV_OPTIONS,
  type JournalBoardNavPane,
  boardNavLevelsForPane,
  effectiveBoardNavLevel,
  readBoardNavVisibility,
  setBoardNavPane,
  writeBoardNavVisibility,
} from '../logic/boardNavVisibility'

const PANE_ICONS: Record<(typeof JOURNAL_BOARD_NAV_OPTIONS)[number], typeof LuInbox> = {
  feeds: LuInbox,
  starred: LuStar,
  notes: LuNotebookPen,
  sites: LuLink,
}

export function WorkbenchHomeOptions() {
  const { t } = useI18n()
  const phantasi = t.phantasi
  const { preferences } = useModuleVisibilityPreferences()
  const parent = preferences.modules.phantasi
  const moduleOpen = parent === 'all'
  const [visibility, setVisibility] = useState(readBoardNavVisibility)
  const labels: Record<(typeof JOURNAL_BOARD_NAV_OPTIONS)[number], string> = {
    feeds: phantasi.boardFeeds,
    starred: phantasi.starred,
    notes: phantasi.boardNotes,
    sites: phantasi.boardSites,
  }
  const visibilityLabels: Record<ModuleVisibilityLevel, string> = {
    all: t.config.moduleVisibilityAll,
    authenticated: t.config.moduleVisibilityAuthenticated,
    admin: t.config.moduleVisibilityAdmin,
  }

  const onChange = (pane: JournalBoardNavPane, level: ModuleVisibilityLevel) => {
    const next = setBoardNavPane(visibility, pane, level, parent)
    writeBoardNavVisibility(next)
    setVisibility(next)
  }

  return (
    <section
      className="phantasi-workbench__home-options"
      aria-label={phantasi.workbenchHomeOptions}
    >
      <h3>{phantasi.workbenchHomeOptions}</h3>
      <SettingGroup
        toc={false}
        title={phantasi.workbenchBoardNavTitle}
        description={phantasi.workbenchBoardNavDesc}
        descriptionVisible
        icon={<LuEye size={15} />}
      >
        <SettingGroupGrid
          columns={2}
          variant="card"
          align="stretch"
          minColumnWidth="16rem"
          ariaLabel={phantasi.workbenchBoardNavTitle}
        >
          {JOURNAL_BOARD_NAV_OPTIONS.map((pane) => {
            const Icon = PANE_ICONS[pane]
            const selected = effectiveBoardNavLevel(visibility, pane, parent)
            const levels = boardNavLevelsForPane(pane)
            return (
              <SettingGroup
                key={pane}
                toc={false}
                title={labels[pane]}
                icon={<Icon size={15} />}
              >
                <SegmentedControl
                  size="sm"
                  columns={levels.length}
                  disabled={!moduleOpen}
                  value={selected}
                  options={levels.map((level) => ({
                    value: level,
                    label: visibilityLabels[level],
                  }))}
                  onChange={(level) => onChange(pane, level)}
                  ariaLabel={labels[pane]}
                />
              </SettingGroup>
            )
          })}
        </SettingGroupGrid>
      </SettingGroup>
    </section>
  )
}
