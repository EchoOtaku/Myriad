import type { ModuleVisibilityLevel } from '../../../utils/moduleVisibility'
import type { JournalBoardNavPane } from '../logic/boardNavVisibility'
import {
  LuEye,
  LuInbox,
  LuLink,
  LuNotebookPen,
} from '@lib/icons'
import { useRef, useState } from 'react'
import { useConfigI18n as useI18n } from '../../../contexts/I18nContext'
import {
  dispatchModuleVisibilityPreferencesUpdated,
  fetchModuleVisibilityPreferences,
  updateModuleVisibilityPreferences,
  useModuleVisibilityPreferences,
} from '../../../utils/moduleVisibility'
import { showToast } from '../../../utils/toastManager'
import { SegmentedControl, SettingGroup, SettingGroupGrid } from '../../settings'
import {
  boardNavAllowsLevel,
  boardNavLevelsForPane,
  effectiveBoardNavLevel,
  ensureBoardNavFloor,
  JOURNAL_BOARD_NAV_OPTIONS,
  normalizeBoardNavVisibility,
  setBoardNavPane,
} from '../logic/boardNavVisibility'

const PANE_ICONS: Record<(typeof JOURNAL_BOARD_NAV_OPTIONS)[number], typeof LuInbox> = {
  feeds: LuInbox,
  notes: LuNotebookPen,
  sites: LuLink,
}

export function WorkbenchHomeOptions() {
  const { t } = useI18n()
  const phantasi = t.phantasi
  const { preferences, isLoading } = useModuleVisibilityPreferences()
  const parent = preferences.modules.phantasi
  const moduleOpen = parent !== 'admin'
  const visibility = ensureBoardNavFloor(
    normalizeBoardNavVisibility(preferences.journalBoards),
    parent,
  )
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const labels: Record<(typeof JOURNAL_BOARD_NAV_OPTIONS)[number], string> = {
    feeds: phantasi.boardFeeds,
    notes: phantasi.boardNotes,
    sites: phantasi.boardSites,
  }
  const descriptions = {
    feeds: phantasi.workbenchBoardFeedsDesc,
    notes: phantasi.workbenchBoardNotesDesc,
    sites: phantasi.workbenchBoardSitesDesc,
  }
  const visibilityLabels: Record<ModuleVisibilityLevel, string> = {
    all: t.config.moduleVisibilityAll,
    authenticated: t.config.moduleVisibilityAuthenticated,
    admin: t.config.moduleVisibilityAdmin,
  }

  const onChange = async (pane: JournalBoardNavPane, level: ModuleVisibilityLevel) => {
    if (savingRef.current || isLoading) return
    savingRef.current = true
    setSaving(true)
    try {
      const current = await fetchModuleVisibilityPreferences()
      const next = setBoardNavPane(
        normalizeBoardNavVisibility(current.journalBoards),
        pane,
        level,
        current.modules.phantasi,
      )
      const saved = await updateModuleVisibilityPreferences({
        ...current,
        journalBoards: { feeds: next.feeds, notes: next.notes, sites: next.sites },
      })
      dispatchModuleVisibilityPreferencesUpdated(saved)
    } catch {
      showToast({ message: t.config.moduleVisibilitySaveFailed, type: 'error' })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <section
      className="phantasi-workbench__home-options"
      aria-label={phantasi.workbenchBoardNavTitle}
    >
      <SettingGroup
        toc={false}
        title={phantasi.workbenchBoardNavTitle}
        description={phantasi.workbenchBoardNavDesc}
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
            const levels = boardNavLevelsForPane(pane, parent)
            return (
              <SettingGroup
                key={pane}
                toc={false}
                title={labels[pane]}
                description={descriptions[pane]}
                icon={<Icon size={15} />}
              >
                <SegmentedControl
                  size="sm"
                  columns={levels.length}
                  disabled={!moduleOpen || isLoading || saving}
                  value={selected}
                  options={levels.map((level) => ({
                    value: level,
                    label: visibilityLabels[level],
                    disabled: !boardNavAllowsLevel(
                      visibility,
                      pane,
                      level,
                      parent,
                    ),
                  }))}
                  onChange={(level) => { void onChange(pane, level) }}
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
