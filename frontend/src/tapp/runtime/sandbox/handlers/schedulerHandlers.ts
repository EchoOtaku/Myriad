/**
 * Scheduler 处理器
 *
 * 接通前端 TappScheduler（WebSocket 客户端）与后端已就绪的调度引擎
 * （/api/tapp/scheduler/*）。让 Tapp 通过 `Tapp.scheduler` 注册定时任务，
 * 后端到期后经 WS 推送 frontend 任务，这里转发进沙箱触发 onTask 回调。
 *
 * 懒连接：仅在 Tapp 首次调用 scheduler.* 时才初始化并建立 WebSocket，
 * 未使用调度的会话不会空开连接。后端权限（scheduler:register）由服务端强制。
 */

import type { TappInstance } from '../../../types'
import type { TappBridge } from '../../TappBridge'
import type { TaskRegistrationOptions } from '../../TappScheduler'
import { API_URL } from '../../../../config'
import { getTappScheduler } from '../../TappScheduler'

let schedulerInitialized = false

/** 懒初始化调度器（设置 apiBaseUrl 并建立 WS，仅一次） */
function ensureScheduler() {
  const scheduler = getTappScheduler()
  if (!schedulerInitialized) {
    // cookie 会话鉴权：authToken 传空，依赖同源 cookie（见 TappScheduler.apiRequest/connect）
    scheduler.initialize(`${API_URL}/api`, '')
    schedulerInitialized = true
  }
  return scheduler
}

function errResult(error: unknown) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed',
  }
}

export function registerSchedulerHandlers(
  bridge: TappBridge,
  tappInstance: TappInstance,
): void {
  bridge.registerHandler('scheduler.register', async (message) => {
    const [options] = (message.payload as { args: unknown[] }).args || []
    const opts = options as TaskRegistrationOptions | undefined
    if (!opts || !opts.taskId || !opts.scheduleType || !opts.schedule) {
      return { success: false, error: 'taskId/scheduleType/schedule required' }
    }
    try {
      const scheduler = ensureScheduler()
      const task = await scheduler.registerTask(tappInstance.id, opts)
      // 将后端推送的任务执行转发进沙箱（onTask 按 tappId:taskId 唯一，重复注册会覆盖）
      scheduler.onTask(tappInstance.id, opts.taskId, (payload) => {
        bridge.emit('schedulerTask', { taskId: opts.taskId, payload })
      })
      return { success: true, data: task }
    } catch (error) {
      return errResult(error)
    }
  })

  bridge.registerHandler('scheduler.cancel', async (message) => {
    const [taskId] = (message.payload as { args: unknown[] }).args || []
    if (!taskId) return { success: false, error: 'taskId required' }
    try {
      const scheduler = ensureScheduler()
      await scheduler.unregisterTask(tappInstance.id, taskId as string)
      return { success: true, data: { taskId, cancelled: true } }
    } catch (error) {
      return errResult(error)
    }
  })

  bridge.registerHandler('scheduler.list', async () => {
    try {
      const scheduler = ensureScheduler()
      const tasks = await scheduler.listTasks(tappInstance.id)
      return { success: true, data: tasks }
    } catch (error) {
      return errResult(error)
    }
  })
}
