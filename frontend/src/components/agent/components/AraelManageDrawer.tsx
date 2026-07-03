/**
 * AraelManageDrawer - 管理面板（左侧栏布局）
 *
 * 左侧图标导航 + 右侧内容区：
 * - 定时任务 (Heartbeat)
 * - 技能 (Skills)
 * - 记忆 (Memory)
 */

import type {
  HeartbeatTask,
  MemoryEntry,
  SkillInfo,
} from '../../../services/agent'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { agentService } from '../../../services/agent'

type ManageTab = 'heartbeat' | 'skills' | 'memory'

export interface AraelManageDrawerProps {}

/** Cron -> human readable */
function humanizeCron(
  cron: string,
  fmt: (template: string, params: Record<string, string | number>) => string,
  arael: { cronEveryMinutes: string; cronDaily: string },
): string {
  if (cron.startsWith('*/')) {
    const mins = cron.split(' ')[0].replace('*/', '')
    return fmt(arael.cronEveryMinutes, { n: Number(mins) })
  }
  const parts = cron.split(' ')
  if (parts.length >= 5) {
    const min = parts[0]
    const hour = parts[1]
    if (hour !== '*' && min !== '*') {
      return fmt(arael.cronDaily, {
        time: `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`,
      })
    }
  }
  return cron
}

const TAB_KEYS: ManageTab[] = ['heartbeat', 'skills', 'memory']

const TAB_ICONS: Record<ManageTab, React.ReactNode> = {
  heartbeat: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  skills: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  memory: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12" />
      <path d="M12 2C6.48 2 2 6.48 2 12" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
}

/** Inline edit component for memory content */
const MemoryEditInput: React.FC<{
  value: string
  onSave: (v: string) => void
  onCancel: () => void
}> = ({ value, onSave, onCancel }) => {
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className="arael-mem-edit">
      <textarea
        ref={inputRef}
        className="arael-mem-edit-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (text.trim()) onSave(text.trim())
          }
          if (e.key === 'Escape') onCancel()
        }}
        rows={2}
      />
      <div className="arael-mem-edit-actions">
        <button
          className="arael-mem-edit-save"
          onClick={() => text.trim() && onSave(text.trim())}
        >
          ✓
        </button>
        <button className="arael-mem-edit-cancel" onClick={onCancel}>
          ✕
        </button>
      </div>
    </div>
  )
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
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)

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
    } catch {
      // API may not be implemented
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTabData(tab)
  }, [tab, loadTabData])

  const handleToggleHeartbeat = useCallback(async (taskId: string) => {
    try {
      const result = await agentService.toggleHeartbeat(taskId)
      setHeartbeatTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, enabled: result.enabled } : t,
        ),
      )
    } catch {
      // ignore
    }
  }, [])

  const handleDeleteMemory = useCallback(async (memoryId: string) => {
    try {
      await agentService.deleteMemory(memoryId)
      setMemories((prev) => prev.filter((m) => m.id !== memoryId))
    } catch {
      // ignore
    }
  }, [])

  const handleUpdateMemory = useCallback(
    async (memoryId: string, newContent: string) => {
      try {
        await agentService.updateMemory(memoryId, newContent)
        setEditingMemoryId(null)
        // Reload to get updated data (id may change)
        const m = await agentService.getMemories()
        setMemories(m)
      } catch {
        // ignore
      }
    },
    [],
  )

  const handleDeleteSkill = useCallback(async (skillId: string) => {
    try {
      await agentService.deleteSkill(skillId)
      setSkills((prev) => prev.filter((s) => s.id !== skillId))
    } catch {
      // ignore
    }
  }, [])

  const memoryTypeLabel = (type: string) => {
    switch (type) {
      case 'preference':
        return i18n.arael.memPreference
      case 'fact':
        return i18n.arael.memFact
      case 'decision':
        return i18n.arael.memDecision
      case 'entity_knowledge':
        return i18n.arael.memKnowledge
      case 'execution_lesson':
        return i18n.arael.memLesson
      case 'effective_pattern':
        return i18n.arael.memPattern
      case 'session_insight':
        return i18n.arael.memInsight
      case 'session_summary':
        return i18n.arael.memSession
      default:
        return i18n.arael.memNote
    }
  }

  return (
    <div className="arael-manage">
      {/* Left sidebar */}
      <div className="arael-manage-sidebar">
        <div className="arael-manage-nav">
          {TAB_KEYS.map((key) => (
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
              {heartbeatTasks.length === 0 ? (
                <div className="arael-manage-empty">
                  {i18n.arael.emptyHeartbeat}
                </div>
              ) : (
                heartbeatTasks.map((task) => (
                  <div key={task.id} className="arael-hb-item">
                    <div className="arael-hb-info">
                      <span className="arael-hb-name">{task.name}</span>
                      <span className="arael-hb-schedule">
                        {humanizeCron(task.schedule, format, i18n.arael)}
                      </span>
                      {task.lastResult && (
                        <div className="arael-hb-result">{task.lastResult}</div>
                      )}
                    </div>
                    <button
                      className={`arael-hb-toggle ${task.enabled ? 'on' : 'off'}`}
                      onClick={() => handleToggleHeartbeat(task.id)}
                    >
                      {task.enabled
                        ? i18n.arael.toggleOn
                        : i18n.arael.toggleOff}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Skills */}
          {!loading && tab === 'skills' && (
            <div className="arael-manage-section">
              {skills.length === 0 ? (
                <div className="arael-manage-empty">
                  {i18n.arael.emptySkills}
                </div>
              ) : (
                skills.map((skill) => (
                  <div key={skill.id} className="arael-skill-item">
                    <div className="arael-skill-header">
                      <span className="arael-skill-name">{skill.name}</span>
                      <div className="arael-skill-header-right">
                        <span
                          className={`arael-skill-origin arael-skill-origin-${skill.origin}`}
                        >
                          {skill.origin === 'manual'
                            ? i18n.arael.originManual
                            : skill.origin === 'agent_generated'
                              ? i18n.arael.originAuto
                              : i18n.arael.originImproved}
                        </span>
                        {skill.origin !== 'manual' && (
                          <button
                            className="arael-manage-delete-btn"
                            onClick={() => handleDeleteSkill(skill.id)}
                            title={i18n.arael.deleteSkill}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="arael-skill-desc">{skill.description}</div>
                    <div className="arael-skill-stats">
                      <span className="arael-skill-stat-ok">
                        {skill.successCount ?? 0} {i18n.arael.statSuccess}
                      </span>
                      <span className="arael-skill-stat-fail">
                        {skill.failureCount ?? 0} {i18n.arael.statFail}
                      </span>
                      {skill.tierHint && (
                        <span
                          className={`arael-tier-badge arael-tier-${skill.tierHint}`}
                        >
                          {skill.tierHint === 'pro' ? 'Pro' : 'Std'}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Memory */}
          {!loading && tab === 'memory' && (
            <div className="arael-manage-section">
              {memories.length === 0 ? (
                <div className="arael-manage-empty">
                  {i18n.arael.emptyMemory}
                </div>
              ) : (
                memories.map((mem) => (
                  <div key={mem.id} className="arael-mem-item">
                    <div className="arael-mem-header">
                      <span className="arael-mem-type">
                        {memoryTypeLabel(mem.memoryType)}
                      </span>
                      <div className="arael-mem-actions">
                        <button
                          className="arael-manage-action-btn"
                          onClick={() =>
                            setEditingMemoryId(
                              editingMemoryId === mem.id ? null : mem.id,
                            )
                          }
                          title={i18n.arael.editMemory}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="arael-manage-delete-btn"
                          onClick={() => handleDeleteMemory(mem.id)}
                          title={i18n.arael.deleteMemory}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {editingMemoryId === mem.id ? (
                      <MemoryEditInput
                        value={mem.content}
                        onSave={(v) => handleUpdateMemory(mem.id, v)}
                        onCancel={() => setEditingMemoryId(null)}
                      />
                    ) : (
                      <span className="arael-mem-content">{mem.content}</span>
                    )}
                    {mem.importance != null && (
                      <div className="arael-mem-meta">
                        <span className="arael-mem-importance">
                          {'★'.repeat(Math.round(mem.importance * 5))}
                        </span>
                        {mem.tier && (
                          <span className="arael-mem-tier">
                            {mem.tier === 'long_term'
                              ? i18n.arael.memTierLong
                              : mem.tier === 'medium_term'
                                ? i18n.arael.memTierMid
                                : i18n.arael.memTierShort}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AraelManageDrawer
