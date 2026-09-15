import type { ReactNode } from 'react'
import { CheckboxCard, SettingSection } from '../../settings'

export function WorkbenchPage({
  title,
  icon,
  guide,
  guidePath,
  action,
  search,
  back,
  children,
}: {
  title: string
  icon: ReactNode
  guide?: ReactNode
  guidePath?: string
  action?: ReactNode
  search?: ReactNode
  back: ReactNode
  children: ReactNode
}) {
  return (
    <SettingSection
      title={title}
      icon={icon}
      guide={guide}
      guidePath={guidePath}
      descriptionVisible={false}
      subtitle={search}
      headerLeading={back}
      headerActions={action ?? false}
      showResetPage={false}
      animated={false}
    >
      {children}
    </SettingSection>
  )
}

export function PageAction({
  label,
  description,
  icon,
  disabled,
  loading,
  onPick,
}: {
  label: string
  description?: string
  icon: ReactNode
  disabled?: boolean
  loading?: boolean
  onPick: () => void
}) {
  return (
    <CheckboxCard
      variant="action"
      tone="primary"
      label={label}
      description={description}
      icon={icon}
      showIndicator={false}
      checked={false}
      onChange={() => onPick()}
      disabled={disabled}
      loading={loading}
      className="setting-section-header-action"
    />
  )
}
