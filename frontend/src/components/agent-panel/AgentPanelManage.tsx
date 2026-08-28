/**
 * 它的设置 —— 定时、技能、记忆。
 *
 * 和会话摆在一起，是因为这三样都是「它」的一部分：定时任务是它自己会去做的事，
 * 技能是它学会的，记忆是它记住的你。**名字和性格不在这里** —— 那是站长的全站
 * 设置，在「设置 · AI」里改，两处都能写只会让人不知道哪份算数。
 *
 * 权限按后端的口径挡在前面：定时任务是站长专属，技能和记忆要登录。宁可先说清楚，
 * 也不去撞一个必然的 401 / 403。
 */

import type {
  HeartbeatTask,
  MemoryEntry,
  SkillInfo,
} from '../../services/agent'
import type { SchedulePreset } from './agentSchedule'
import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { relativeTimeBucket } from './agentRelativeTime'
import {
  describeSchedule,
  isPlausibleCron,
  matchSchedulePreset,
  SCHEDULE_PRESETS,
} from './agentSchedule'

type ManageTab = 'heartbeat' | 'skills' | 'memory'

interface TaskDraft {
  id: string | null
  name: string
  schedule: string
  action: string
}

const EMPTY_DRAFT: TaskDraft = {
  id: null,
  name: '',
  schedule: '0 9 * * *',
  action: '',
}

export const AgentPanelManage: React.FC = () => {
  const { t, format, locale } = useI18n()
  const { isAuthenticated, isAdmin } = useAuth()
  const [tab, setTab] = useState<ManageTab>('heartbeat')
  const [tasks, setTasks] = useState<HeartbeatTask[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  /**
   * 勿扰是「跟当前这个人相处」的状态，不是站长的全站设置 —— 所以它在这里，
   * 而不是跟名字性格一起去 /config。
   */
  const [doNotDisturb, setDoNotDisturb] = useState<boolean | null>(null)
  /** 正在改的那条记忆。记忆是它对你的理解，改错了比删掉更难受，所以能改。 */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  )

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    void (async () => {
      try {
        const persona = await agentService.getPersona()
        if (!cancelled) setDoNotDisturb(persona?.doNotDisturb === true)
      } catch {
        // 读不到就不摆这个开关，别给一个点了没反应的东西
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const load = useCallback(
    async (which: ManageTab) => {
      setNote(null)
      if (!isAuthenticated) {
        setNote(t.agentPanel.manage.needLogin)
        return
      }
      try {
        if (which === 'heartbeat') {
          // 后端这条接口是站长专属，非站长直接说明白，不去撞 403
          if (!isAdmin) {
            setTasks([])
            setNote(t.agentPanel.manage.adminOnly)
            return
          }
          setTasks(await agentService.getHeartbeatTasks())
        } else if (which === 'skills') {
          setSkills(await agentService.getSkills())
        } else {
          setMemories(await agentService.getMemories())
        }
      } catch {
        setNote(t.agentPanel.manage.loadFailed)
      }
    },
    [isAuthenticated, isAdmin, t.agentPanel.manage],
  )

  useEffect(() => {
    void load(tab)
  }, [tab, load])

  const describe = (task: HeartbeatTask): string => {
    const shape = describeSchedule(task.schedule)
    switch (shape.kind) {
      case 'everyMinutes':
        return format(t.agentPanel.manage.everyMinutes, { value: shape.value })
      case 'everyHours':
        return format(t.agentPanel.manage.everyHours, { value: shape.value })
      case 'hourly':
        return t.agentPanel.manage.hourly
      case 'dailyAt':
        return format(t.agentPanel.manage.dailyAt, { time: shape.time })
      default:
        return shape.cron
    }
  }

  const lastRunLabel = (task: HeartbeatTask): string => {
    const bucket = relativeTimeBucket(task.lastRun, Date.now())
    if (!bucket) return t.agentPanel.manage.neverRun
    const time =
      bucket.kind === 'justNow'
        ? t.agentPanel.sessions.justNow
        : bucket.kind === 'minutes'
          ? format(t.agentPanel.sessions.minutesAgo, { value: bucket.value })
          : bucket.kind === 'hours'
            ? format(t.agentPanel.sessions.hoursAgo, { value: bucket.value })
            : bucket.kind === 'days'
              ? format(t.agentPanel.sessions.daysAgo, { value: bucket.value })
              : bucket.date.toLocaleDateString(locale || undefined)
    return format(t.agentPanel.manage.lastRun, { time })
  }

  const guard = async (run: () => Promise<unknown>) => {
    try {
      await run()
      await load(tab)
    } catch {
      setNote(t.agentPanel.manage.actionFailed)
    }
  }

  const saveDraft = async () => {
    if (!draft) return
    if (!isPlausibleCron(draft.schedule)) {
      setNote(t.agentPanel.manage.badCron)
      return
    }
    const body = {
      name: draft.name.trim(),
      schedule: draft.schedule.trim(),
      action: draft.action.trim(),
    }
    if (!body.name || !body.action) return
    await guard(() =>
      draft.id
        ? agentService.updateHeartbeat(draft.id, body)
        : agentService.createHeartbeat({ ...body, enabled: true }),
    )
    setDraft(null)
  }

  const preset: SchedulePreset = draft
    ? matchSchedulePreset(draft.schedule)
    : 'custom'

  return (
    <div className="agent-panel-manage">
      <div className="agent-panel-manage-tabs" role="tablist">
        {(['heartbeat', 'skills', 'memory'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="agent-panel-manage-tab"
            data-active={tab === id ? 'true' : 'false'}
            onClick={() => {
              setTab(id)
              setDraft(null)
            }}
          >
            {t.agentPanel.manage.tabs[id]}
          </button>
        ))}
      </div>

      <div className="agent-panel-manage-body">
        {note && (
          <span className="agent-panel-tag" data-block="true" data-tone="alert">
            {note}
          </span>
        )}

        {tab === 'heartbeat' && !note && (
          <>
            {tasks.length === 0 && !draft && (
              <span className="agent-panel-tag" data-block="true">
                {t.agentPanel.manage.emptyHeartbeat}
              </span>
            )}
            {tasks.map((task) => (
              <div key={task.id} className="agent-panel-manage-row">
                <button
                  type="button"
                  className="agent-panel-manage-main"
                  onClick={() =>
                    setDraft({
                      id: task.id,
                      name: task.name,
                      schedule: task.schedule,
                      action: task.action,
                    })
                  }
                >
                  <span className="agent-panel-manage-name">{task.name}</span>
                  <span className="agent-panel-manage-meta">
                    {describe(task)} · {lastRunLabel(task)}
                  </span>
                </button>
                <button
                  type="button"
                  className="agent-panel-manage-toggle"
                  data-on={task.enabled ? 'true' : 'false'}
                  aria-pressed={task.enabled}
                  onClick={() =>
                    guard(() => agentService.toggleHeartbeat(task.id))
                  }
                >
                  <span className="agent-panel-manage-knob" />
                </button>
                <button
                  type="button"
                  className="agent-panel-manage-remove"
                  title={t.agentPanel.manage.remove}
                  aria-label={t.agentPanel.manage.remove}
                  onClick={() => {
                    if (
                      !window.confirm(
                        format(t.agentPanel.manage.confirmRemove, {
                          name: task.name,
                        }),
                      )
                    ) {
                      return
                    }
                    void guard(() => agentService.deleteHeartbeat(task.id))
                  }}
                >
                  ×
                </button>
              </div>
            ))}

            {draft ? (
              <div className="agent-panel-manage-form">
                <input
                  className="agent-panel-input"
                  value={draft.name}
                  placeholder={t.agentPanel.manage.taskName}
                  aria-label={t.agentPanel.manage.taskName}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
                <input
                  className="agent-panel-input"
                  value={draft.action}
                  placeholder={t.agentPanel.manage.taskAction}
                  aria-label={t.agentPanel.manage.taskAction}
                  onChange={(event) =>
                    setDraft({ ...draft, action: event.target.value })
                  }
                />
                <div className="agent-panel-manage-presets">
                  {SCHEDULE_PRESETS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="agent-panel-chip"
                      data-active={preset === option.id ? 'true' : 'false'}
                      onClick={() =>
                        setDraft({ ...draft, schedule: option.cron })
                      }
                    >
                      {
                        t.agentPanel.manage[
                          `preset${option.id.charAt(0).toUpperCase()}${option.id.slice(1)}` as 'preset15m'
                        ]
                      }
                    </button>
                  ))}
                </div>
                <input
                  className="agent-panel-input agent-panel-manage-cron"
                  value={draft.schedule}
                  aria-label={t.agentPanel.manage.taskSchedule}
                  onChange={(event) =>
                    setDraft({ ...draft, schedule: event.target.value })
                  }
                />
                <div className="agent-panel-action-buttons">
                  <button
                    type="button"
                    className="agent-panel-action-cancel"
                    onClick={() => setDraft(null)}
                  >
                    {t.agentPanel.manage.cancel}
                  </button>
                  <button
                    type="button"
                    className="agent-panel-action-confirm"
                    onClick={() => void saveDraft()}
                    disabled={!draft.name.trim() || !draft.action.trim()}
                  >
                    {t.agentPanel.manage.save}
                  </button>
                </div>
              </div>
            ) : (
              isAdmin && (
                <button
                  type="button"
                  className="agent-panel-chip agent-panel-manage-add"
                  onClick={() => setDraft(EMPTY_DRAFT)}
                >
                  {t.agentPanel.manage.newTask}
                </button>
              )
            )}
          </>
        )}

        {tab === 'skills' && !note && (
          <>
            {skills.length === 0 && (
              <span className="agent-panel-tag" data-block="true">
                {t.agentPanel.manage.emptySkills}
              </span>
            )}
            {skills.map((skill) => (
              <div key={skill.id} className="agent-panel-manage-row">
                <div className="agent-panel-manage-main">
                  <span className="agent-panel-manage-name">{skill.name}</span>
                  <span className="agent-panel-manage-meta">
                    {skill.description}
                  </span>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    className="agent-panel-manage-remove"
                    title={t.agentPanel.manage.remove}
                    aria-label={t.agentPanel.manage.remove}
                    onClick={() => {
                      if (
                        !window.confirm(
                          format(t.agentPanel.manage.confirmRemove, {
                            name: skill.name,
                          }),
                        )
                      ) {
                        return
                      }
                      void guard(() => agentService.deleteSkill(skill.id))
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'memory' && !note && (
          <>
            {memories.length === 0 && (
              <span className="agent-panel-tag" data-block="true">
                {t.agentPanel.manage.emptyMemory}
              </span>
            )}
            {memories.map((memory) =>
              editing?.id === memory.id ? (
                <div key={memory.id} className="agent-panel-manage-form">
                  <input
                    className="agent-panel-input"
                    value={editing.text}
                    aria-label={t.agentPanel.edit}
                    onChange={(event) =>
                      setEditing({ id: memory.id, text: event.target.value })
                    }
                  />
                  <div className="agent-panel-action-buttons">
                    <button
                      type="button"
                      className="agent-panel-action-cancel"
                      onClick={() => setEditing(null)}
                    >
                      {t.agentPanel.manage.cancel}
                    </button>
                    <button
                      type="button"
                      className="agent-panel-action-confirm"
                      disabled={!editing.text.trim()}
                      onClick={() => {
                        const text = editing.text.trim()
                        setEditing(null)
                        void guard(() =>
                          agentService.updateMemory(memory.id, text),
                        )
                      }}
                    >
                      {t.agentPanel.manage.save}
                    </button>
                  </div>
                </div>
              ) : (
                <div key={memory.id} className="agent-panel-manage-row">
                  <button
                    type="button"
                    className="agent-panel-manage-main"
                    onClick={() =>
                      setEditing({ id: memory.id, text: memory.content })
                    }
                  >
                    <span className="agent-panel-manage-meta">
                      {memory.content}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="agent-panel-manage-remove"
                    title={t.agentPanel.manage.remove}
                    aria-label={t.agentPanel.manage.remove}
                    onClick={() =>
                      void guard(() => agentService.deleteMemory(memory.id))
                    }
                  >
                    ×
                  </button>
                </div>
              ),
            )}
          </>
        )}
      </div>

      {doNotDisturb !== null && (
        <div className="agent-panel-manage-row agent-panel-manage-dnd">
          <span className="agent-panel-manage-name">
            {t.agentPanel.manage.doNotDisturb}
          </span>
          <button
            type="button"
            className="agent-panel-manage-toggle"
            data-on={doNotDisturb ? 'true' : 'false'}
            aria-pressed={doNotDisturb}
            aria-label={t.agentPanel.manage.doNotDisturb}
            onClick={() => {
              const next = !doNotDisturb
              // 先动界面 —— 这个开关的意义是「立刻别烦我」，等一个往返太久
              setDoNotDisturb(next)
              void agentService
                .putAddressee({ doNotDisturb: next })
                .catch(() => {
                  setDoNotDisturb(!next)
                  setNote(t.agentPanel.manage.actionFailed)
                })
            }}
          >
            <span className="agent-panel-manage-knob" />
          </button>
        </div>
      )}

      <span
        className="agent-panel-tag agent-panel-manage-hint"
        data-block="true"
      >
        {t.agentPanel.manage.personaElsewhere}
      </span>
    </div>
  )
}

export default AgentPanelManage
