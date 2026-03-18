/**
 * AraelManageDrawer - 管理面板（左侧栏布局）
 *
 * 左侧图标导航 + 右侧内容区：
 * - 定时任务 (Heartbeat)
 * - 技能 (Skills)
 * - 记忆 (Memory)
 */

import type { HeartbeatTask, MemoryEntry, SkillInfo } from '../../../services/agent'
import React, { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { agentService } from '../../../services/agent'

type ManageTab = 'heartbeat' | 'skills' | 'memory'

export interface AraelManageDrawerProps {}

/** Cron -> human readable */
function humanizeCron(cron: string, fmt: (template: string, params: Record<string, string | number>) => string, arael: { cronEveryMinutes: string; cronDaily: string }): string {
  if (cron.startsWith('*/')) {
    const mins = cron.split(' ')[0].replace('*/', '')
    return fmt(arael.cronEveryMinutes, { n: Number(mins) })
  }
  const parts = cron.split(' ')
  if (parts.length >= 5) {
    const min = parts[0]
    const hour = parts[1]
    if (hour !== '*' && min !== '*') {
      return fmt(arael.cronDaily, { time: `${hour.padStart(2, '0')}:${min.padStart(2, '0')}` })
    }
  }
  return cron
}

const TAB_KEYS: ManageTab[] = ['heartbeat', 'skills', 'memory']

const TAB_ICONS: Record<ManageTab, React.ReactNode> = {
  heartbeat: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  skills: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  memory: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12" />
      <path d="M12 2C6.48 2 2 6.48 2 12" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
}

export const AraelManageDrawer: React.FC<AraelManageDrawerProps> = () => {
  const { t: i18n, format } = useI18n()
  const [tab, setTab] = useState<ManageTab>('heartbeat')

  const tabLabels: Record<ManageTab, string> = {
    heartbeat: i18n.arael.tabHeartbeat,
    skills: i18n.arael.tabSkills,
    memory: i18n.arael.tabMemory,
  }
  const [heartbeatTasks, setHeartbeatTasks] = useState<HeartbeatTask[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)

  const loadTabData = useCallback(async (currentTab: ManageTab) => {
    setLoading(true)
    try {
      switch (currentTab) {
        case 'heartbeat': {
          const tasks = await agentService.getHeartbeatTasks()
          setHeartbeatTasks(tasks)
          break
        }
        case 'skills': {
          const s = await agentService.getSkills()
          setSkills(s)
          break
        }
        case 'memory': {
          const m = await agentService.getMemories()
          setMemories(m)
          break
        }
      }
    }
    catch {
      // API may not be implemented
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTabData(tab)
  }, [tab, loadTabData])

  const handleToggleHeartbeat = useCallback(async (taskId: string) => {
    try {
      const result = await agentService.toggleHeartbeat(taskId)
      setHeartbeatTasks(prev =>
        prev.map(t => t.id === taskId ? { ...t, enabled: result.enabled } : t),
      )
    }
    catch {
      // ignore
    }
  }, [])

  return (
    <div className="arael-manage">
      {/* Left sidebar */}
      <div className="arael-manage-sidebar">
        <div className="arael-manage-nav">
          {TAB_KEYS.map(key => (
            <button
              key={key}
              className={`arael-manage-nav-item${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
              title={tabLabels[key]}
            >
              {TAB_ICONS[key]}
              <span className="arael-manage-nav-label">{tabLabels[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right content */}
      <div className="arael-manage-main">
        <div className="arael-manage-main-content">
          {loading && (
            <div className="arael-manage-loading">
              <span className="arael-spinner-small" />
            </div>
          )}

          {/* Heartbeat */}
          {!loading && tab === 'heartbeat' && (
            <div className="arael-manage-section">
              {heartbeatTasks.length === 0
                ? <div className="arael-manage-empty">{i18n.arael.emptyHeartbeat}</div>
                : heartbeatTasks.map(task => (
                    <div key={task.id} className="arael-hb-item">
                      <div className="arael-hb-info">
                        <span className="arael-hb-name">{task.name}</span>
                        <span className="arael-hb-schedule">{humanizeCron(task.schedule, format, i18n.arael)}</span>
                        {task.lastResult && (
                          <div className="arael-hb-result">{task.lastResult}</div>
                        )}
                      </div>
                      <button
                        className={`arael-hb-toggle ${task.enabled ? 'on' : 'off'}`}
                        onClick={() => handleToggleHeartbeat(task.id)}
                      >
                        {task.enabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  ))}
            </div>
          )}

          {/* Skills */}
          {!loading && tab === 'skills' && (
            <div className="arael-manage-section">
              {skills.length === 0
                ? <div className="arael-manage-empty">{i18n.arael.emptySkills}</div>
                : skills.map(skill => (
                    <div key={skill.id} className="arael-skill-item">
                      <div className="arael-skill-header">
                        <span className="arael-skill-name">{skill.name}</span>
                        <span className={`arael-skill-origin arael-skill-origin-${skill.origin}`}>
                          {skill.origin === 'manual' ? i18n.arael.originManual : skill.origin === 'agent_generated' ? i18n.arael.originAuto : i18n.arael.originImproved}
                        </span>
                      </div>
                      <div className="arael-skill-desc">{skill.description}</div>
                      <div className="arael-skill-stats">
                        <span className="arael-skill-stat-ok">
                          {skill.successCount ?? 0}
                          {' '}
                          {i18n.arael.statSuccess}
                        </span>
                        <span className="arael-skill-stat-fail">
                          {skill.failureCount ?? 0}
                          {' '}
                          {i18n.arael.statFail}
                        </span>
                        {skill.tierHint && (
                          <span className={`arael-tier-badge arael-tier-${skill.tierHint}`}>
                            {skill.tierHint === 'pro' ? 'Pro' : 'Std'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
            </div>
          )}

          {/* Memory */}
          {!loading && tab === 'memory' && (
            <div className="arael-manage-section">
              {memories.length === 0
                ? <div className="arael-manage-empty">{i18n.arael.emptyMemory}</div>
                : memories.map((mem, i) => (
                    <div key={i} className="arael-mem-item">
                      <span className="arael-mem-type">
                        {mem.memoryType === 'preference' ? i18n.arael.memPreference
                          : mem.memoryType === 'fact' ? i18n.arael.memFact
                            : mem.memoryType === 'decision' ? i18n.arael.memDecision
                              : i18n.arael.memNote}
                      </span>
                      <span className="arael-mem-content">{mem.content}</span>
                    </div>
                  ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AraelManageDrawer
