/**
 * 思考过程 —— 一行，点开才是几步。
 *
 * 默认收着：跑完之后用户要的是答案，不是流水账。跑的过程中那一行会说清楚现在
 * 卡在哪一步，因为**等待的时候人最需要知道自己在等什么**。
 *
 * 出错时默认展开 —— 那一刻流水账就是答案的一部分。
 */

import type { AgentMessageStep } from './agentThinking'
import React, { useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import {
  formatStepDuration,
  stepsWorthShowing,
  summarizeAgentSteps,
} from './agentThinking'
import { AgentPresence, AgentSwap } from './useAgentPresence'

const STATUS_MARK: Record<AgentMessageStep['status'], string> = {
  pending: '·',
  running: '·',
  done: '✓',
  error: '✗',
}

export const AgentPanelThinking: React.FC<{ steps: AgentMessageStep[] }> = ({
  steps,
}) => {
  const { t, format } = useI18n()
  const summary = summarizeAgentSteps(steps)
  const [expanded, setExpanded] = useState(summary.failed)

  if (!stepsWorthShowing(steps)) return null

  const headline = summary.running
    ? summary.running
    : summary.failed
      ? t.agentPanel.thinking.failed
      : format(t.agentPanel.thinking.doneSteps, { count: summary.total })

  return (
    <div
      className="agent-panel-thinking"
      data-failed={summary.failed ? 'true' : 'false'}
    >
      <button
        type="button"
        className="agent-panel-thinking-head"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <span className="agent-panel-thinking-headline">
          <AgentSwap id={headline} from="self">
            <span>{headline}</span>
          </AgentSwap>
        </span>
        {summary.elapsedMs !== null && (
          <span className="agent-panel-thinking-elapsed">
            {formatStepDuration(summary.elapsedMs)}
          </span>
        )}
        <svg
          className="agent-panel-thinking-arrow"
          data-open={expanded ? 'true' : 'false'}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      <AgentPresence open={expanded} kind="row" from="self">
        <ol className="agent-panel-thinking-steps">
          {steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span className="agent-panel-thinking-mark" aria-hidden="true">
                {STATUS_MARK[step.status]}
              </span>
              <span className="agent-panel-thinking-name">{step.name}</span>
              {typeof step.durationMs === 'number' && (
                <span className="agent-panel-thinking-elapsed">
                  {formatStepDuration(step.durationMs)}
                </span>
              )}
              {step.note && (
                <span className="agent-panel-thinking-note">{step.note}</span>
              )}
            </li>
          ))}
        </ol>
      </AgentPresence>
    </div>
  )
}

