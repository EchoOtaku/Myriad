import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import {
  LuExternalLink,
  LuGitFork,
  LuScale,
  LuTag,
  LuUsers,
} from '../../lib/icons'
import { agentService } from '../../services/agent'
import { getBuildInfo } from '../../utils/buildInfo'
import { SettingGroup, SettingSection, useSettingGuide } from '../settings'
import { UpdaterInlinePanel } from './UpdaterConfigSection'

interface AboutConfigSectionProps {
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
}

const ORG_NAME = 'Myriad-You'
const REPO_NAME = 'Myriad-You/Myriad'
const ORG_URL = 'https://github.com/Myriad-You'
const REPO_URL = 'https://github.com/Myriad-You/Myriad'

/** Minimal MCP status/reload for About (deep-link mcp→about). Admin only. */
function McpInlinePanel() {
  const { t } = useI18n()
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toolCount, setToolCount] = useState(0)
  const [servers, setServers] = useState<Array<Record<string, unknown>>>([])

  const load = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    setError(null)
    try {
      const status = await agentService.getMcpStatus()
      setServers(status.servers)
      setToolCount(status.tool_count)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MCP status failed')
      setServers([])
      setToolCount(0)
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    void load()
  }, [load])

  const onReload = useCallback(async () => {
    if (!isAdmin || reloading) return
    setReloading(true)
    setError(null)
    try {
      const result = await agentService.reloadMcp()
      setToolCount(result.tool_count)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MCP reload failed')
    } finally {
      setReloading(false)
    }
  }, [isAdmin, reloading, load])

  if (!isAdmin) return null

  return (
    <SettingGroup>
      <div className="about" data-setting-path="about.mcp">
        <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
          MCP
        </h4>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          {loading
            ? '…'
            : `${servers.length} server(s) · ${toolCount} tool(s)`}
        </p>
        {error && (
          <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
            {error}
          </p>
        )}
        {servers.length > 0 && (
          <ul className="mb-3 space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {servers.map((s, i) => {
              const name = String(s.name ?? s.id ?? `server-${i}`)
              const st = String(s.status ?? s.state ?? '')
              return (
                <li key={name}>
                  <span className="font-medium">{name}</span>
                  {st ? ` — ${st}` : ''}
                </li>
              )
            })}
          </ul>
        )}
        <button
          type="button"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          onClick={() => void onReload()}
          disabled={reloading || loading}
        >
          {reloading ? '…' : t.config.forceRefreshFrontendCacheButton || 'Reload'}
        </button>
      </div>
    </SettingGroup>
  )
}

export const AboutConfigSection: React.FC<AboutConfigSectionProps> = ({
  title,
  icon,
  description,
  sectionId,
}) => {
  const { t } = useI18n()
  const { catalog: g, renderGuide, bindGuide } = useSettingGuide()
  const buildInfo = getBuildInfo()

  const devInfo: Array<{
    label: string
    value: string
    icon: React.ReactNode
    href?: string
  }> = [
    {
      label: t.config.aboutVersion,
      value: buildInfo.commitSha
        ? `${buildInfo.version} · ${buildInfo.commitSha.slice(0, 7)}`
        : buildInfo.version,
      icon: <LuTag />,
      href: buildInfo.commitUrl ?? undefined,
    },
    { label: t.config.aboutLicense, value: 'GPL-3.0', icon: <LuScale /> },
    {
      label: t.config.aboutOrganization,
      value: ORG_NAME,
      icon: <LuUsers />,
      href: ORG_URL,
    },
    {
      label: t.config.aboutRepository,
      value: REPO_NAME,
      icon: <LuGitFork />,
      href: REPO_URL,
    },
  ]

  return (
    <SettingSection
      showResetPage={false}
      helpToggle={true}
      title={title}
      icon={icon}
      description={description}
      {...bindGuide('about.section', g.about.section)}
      sectionId={sectionId}
    >
      <SettingGroup>
        <div className="about">
          <div className="about-hero">
            <img
              src="/logo.webp"
              alt={t.config.aboutLogoAlt}
              className="about-logo"
            />
            <h3 className="about-name">Myriad</h3>
            <p className="about-tagline">{t.config.aboutTagline}</p>
          </div>

          <div className="about-bento">
            {devInfo.map((card) => {
              const inner = (
                <>
                  <span className="about-card-label">
                    <span className="about-card-icon" aria-hidden="true">
                      {card.icon}
                    </span>
                    {card.label}
                  </span>
                  <span className="about-card-value">{card.value}</span>
                </>
              )
              return card.href ? (
                <a
                  key={card.label}
                  className="about-card is-link"
                  href={card.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {inner}
                  <span className="about-card-arrow" aria-hidden="true">
                    <LuExternalLink />
                  </span>
                </a>
              ) : (
                <div key={card.label} className="about-card">
                  {inner}
                </div>
              )
            })}
          </div>
        </div>
      </SettingGroup>

      {/* Updater 管理（仅 admin 可见；非 admin 调 /api/admin/updater/* 会 403，UI 自然提示） */}
      <UpdaterInlinePanel heading={t.config.updaterTitle} />
      {/* MCP status/reload — deep-link section=mcp → about */}
      <McpInlinePanel />
    </SettingSection>
  )
}

export default AboutConfigSection
