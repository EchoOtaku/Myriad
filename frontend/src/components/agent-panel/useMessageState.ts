/**
 * 对话消息的增删改 —— 执行引擎的内部状态。
 *
 * 引擎这边的消息比新 UI 画出来的那份重得多：执行追踪、调试轨迹、待答问题都挂在
 * 上面。这些只在这里用，`agentMessages` 那份才是给界面看的。
 *
 * 提供的操作：
 * - updateMessage: 更新消息属性
 * - updateMessageExecution: 更新消息的执行状态
 * - addExecutionStep: 添加执行步骤
 * - updateExecutionStep: 更新执行步骤
 */

import type { ChatMessage, ExecutionStep, TaskExecution } from './engineTypes'
import { useCallback, useRef, useState } from 'react'

export function useMessageState() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ChatMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
      )
    },
    [],
  )

  const updateMessageExecution = useCallback(
    (messageId: string, updates: Partial<TaskExecution>) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.taskExecution) return m
          // progress 仅递增，避免回退
          const newProgress =
            updates.progress != null
              ? Math.max(updates.progress, m.taskExecution.progress)
              : m.taskExecution.progress
          return {
            ...m,
            taskExecution: {
              ...m.taskExecution,
              ...updates,
              progress: newProgress,
            },
          }
        }),
      )
    },
    [],
  )

  const addExecutionStep = useCallback(
    (messageId: string, step: ExecutionStep) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.taskExecution) return m
          const exists = m.taskExecution.steps.some((s) => s.id === step.id)
          if (exists) {
            return {
              ...m,
              taskExecution: {
                ...m.taskExecution,
                steps: m.taskExecution.steps.map((s) =>
                  s.id === step.id ? { ...s, ...step } : s,
                ),
              },
            }
          }
          return {
            ...m,
            taskExecution: {
              ...m.taskExecution,
              steps: [...m.taskExecution.steps, step],
            },
          }
        }),
      )
    },
    [],
  )

  const updateExecutionStep = useCallback(
    (messageId: string, stepId: string, updates: Partial<ExecutionStep>) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.taskExecution) return m
          return {
            ...m,
            taskExecution: {
              ...m.taskExecution,
              steps: m.taskExecution.steps.map((s) =>
                s.id === stepId ? { ...s, ...updates } : s,
              ),
            },
          }
        }),
      )
    },
    [],
  )

  return {
    messages,
    setMessages,
    messagesRef,
    updateMessage,
    updateMessageExecution,
    addExecutionStep,
    updateExecutionStep,
  }
}
