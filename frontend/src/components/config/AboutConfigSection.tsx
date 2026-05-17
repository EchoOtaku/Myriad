import React from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { SettingGroup, SettingSection } from '../settings'
import { UpdaterInlinePanel } from './UpdaterConfigSection'

interface AboutConfigSectionProps {
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
}

const MYRIAD_VERSION = __APP_VERSION__ || '0.1.0'
const ORG_NAME = 'myriad-you'
const REPO_URL = 'https://github.com/myriad-you/Myriad'
const ORG_URL = 'https://github.com/myriad-you'

export const AboutConfigSection: React.FC<AboutConfigSectionProps> = ({
  title,
  icon,
  description,
  sectionId,
}) => {
  const { t } = useI18n()

  const devInfo: Array<{ label: string, value: React.ReactNode }> = [
    { label: t.config.aboutVersion, value: `v${MYRIAD_VERSION}` },
    { label: t.config.aboutLicense, value: 'GPL-3.0' },
    {
      label: t.config.aboutOrganization,
      value: (
        <a className="about-row-link" href={ORG_URL} target="_blank" rel="noreferrer noopener">
          {ORG_NAME}
        </a>
      ),
    },
    {
      label: t.config.aboutRepository,
      value: (
        <a className="about-row-link" href={REPO_URL} target="_blank" rel="noreferrer noopener">
          github.com/myriad-you/Myriad
        </a>
      ),
    },
  ]

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
    >
      <SettingGroup>
        <div className="about">
          <div className="about-hero">
            <img src="/logo.webp" alt={t.config.aboutLogoAlt} className="about-logo" />
            <h3 className="about-name">Myriad</h3>
            <p className="about-tagline">{t.config.aboutTagline}</p>
          </div>

          <ul className="about-list" role="list">
            {devInfo.map((row, idx) => (
              <li
                key={row.label}
                className={`about-row${idx === devInfo.length - 1 ? ' is-last' : ''}`}
              >
                <span className="about-row-label">{row.label}</span>
                <span className="about-row-value">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </SettingGroup>

      {/* Updater 管理（仅 admin 可见；非 admin 调 /api/admin/updater/* 会 403，UI 自然提示） */}
      <UpdaterInlinePanel heading={t.config.updaterTitle} />
    </SettingSection>
  )
}

export default AboutConfigSection
