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
}: {
  value: AddFieldKind
  onChange?: (kind: AddFieldKind) => void
  disabled?: boolean
}) {
  const brew = useI18n().t.brew
  return (
    <div className="setting-item setting-item-select setting-vertical setting-sm brew-add-form__type">
      <div className="setting-label">
        <span className="setting-label-text">{brew.sourceTypeLabel}</span>
      </div>
      <div className="setting-control">
        <SegmentedControl<AddFieldKind>
          size="sm"
          columns={4}
          className="brew-add-form__kinds"
          ariaLabel={brew.sourceTypeLabel}
          value={value}
          onChange={(kind) => onChange?.(kind)}
          disabled={disabled}
          options={[
            {
              value: 'link',
              label: brew.pureLink,
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
      <p className="setting-hint">{brew[addHintKey(value)]}</p>
    </div>
  )
}
