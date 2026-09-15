import type { AddFieldKind } from './addSource'
import {
  LuExternalLink as ExternalLink,
  NotionIcon,
  LuRss as Rss,
  RSSHubIcon,
} from '@lib/icons'
import { useI18n } from '../../../../contexts/I18nContext'
import { SegmentedControl } from '../../../settings/items/ChoiceControls'
import { addHintKey } from './addSource'

export function SourceKindControl({
  value,
  onChange,
  disabled = false,
  hideLabel = false,
}: {
  value: AddFieldKind
  onChange?: (kind: AddFieldKind) => void
  disabled?: boolean
  hideLabel?: boolean
}) {
  const phantasi = useI18n().t.phantasi
  return (
    <div className="setting-item setting-item-select setting-vertical setting-sm phantasi-add-form__type">
      {hideLabel ? null : (
        <div className="setting-label">
          <span className="setting-label-text">{phantasi.sourceTypeLabel}</span>
        </div>
      )}
      <div className="setting-control">
        <SegmentedControl<AddFieldKind>
          size="sm"
          columns={4}
          className="phantasi-add-form__kinds"
          ariaLabel={phantasi.sourceTypeLabel}
          value={value}
          onChange={(kind) => onChange?.(kind)}
          disabled={disabled}
          options={[
            {
              value: 'link',
              label: phantasi.pureLink,
              icon: <ExternalLink />,
              disabled,
            },
            { value: 'rss', label: 'RSS', icon: <Rss />, disabled },
            {
              value: 'rsshub',
              label: 'RSSHub',
              icon: <RSSHubIcon />,
              disabled,
            },
            {
              value: 'notion',
              label: 'Notion',
              icon: <NotionIcon />,
              disabled,
            },
          ]}
        />
      </div>
      {hideLabel ? null : (
        <p className="setting-hint">{phantasi[addHintKey(value)]}</p>
      )}
    </div>
  )
}
