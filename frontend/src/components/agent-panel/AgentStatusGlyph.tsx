/**
 * 状态图元。
 *
 * 设计语言里写的是 `◇ ◌ ≈ ··· ! ✓`，但那几个字符跨字体宽度差很大，`◇` 在部分
 * 系统还会被 emoji 化，所以一律画出来。字面符号留在 `AGENT_STATUS_SYMBOL` 里
 * 当权威说法用。
 *
 * 岛和 Quick Overlay 共用这一份 —— 同一个状态在两档里不该长得不一样。
 */

import type { AgentStatus } from './agentStatus'
import React from 'react'

const PATHS: Record<AgentStatus, React.ReactNode> = {
  idle: <path d="M12 3.6 20.4 12 12 20.4 3.6 12Z" />,
  listening: <circle cx="12" cy="12" r="8" strokeDasharray="3 3.4" />,
  thinking: (
    <>
      <path d="M4 9.6c1.6-2 3.2-2 4.8 0s3.2 2 4.8 0 3.2-2 4.4 0" />
      <path d="M4 15c1.6-2 3.2-2 4.8 0s3.2 2 4.8 0 3.2-2 4.4 0" />
    </>
  ),
  working: (
    <>
      <circle className="agent-panel-dot" cx="6" cy="12" r="1.7" />
      <circle className="agent-panel-dot" cx="12" cy="12" r="1.7" />
      <circle className="agent-panel-dot" cx="18" cy="12" r="1.7" />
    </>
  ),
  needsInput: (
    <>
      <path d="M12 5.2v8.4" />
      <circle cx="12" cy="18.2" r="1.3" />
    </>
  ),
  done: <path d="M5 12.6 10 17.6 19 7" />,
  error: (
    <>
      <path d="M6.6 6.6 17.4 17.4" />
      <path d="M17.4 6.6 6.6 17.4" />
    </>
  ),
}

/** 实心图元（点、句号）不该被描边填成空心。 */
const FILLED: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  'working',
  'needsInput',
])

export const AgentStatusGlyph: React.FC<{
  status: AgentStatus
  className?: string
}> = ({ status, className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill={FILLED.has(status) ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {PATHS[status]}
  </svg>
)

export default AgentStatusGlyph
