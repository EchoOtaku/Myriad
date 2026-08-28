/**
 * 面板进出场的联调契约。
 *
 * 动效回归几乎都是「CSS 选择器还在写已经不存在的 DOM」。肉眼对一次不够，
 * 把层次写进测试：开合只动锚点、对话区不能再单独位移、
 * 时长和 CSS 令牌对齐。改结构时这组断言会红。
 *
 * Run from frontend/:
 *   pnpm test:unit -- src/components/agent-panel/agentPanelMotion.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { AGENT_ROW_MS } from './agentPresenceState'
import { AGENT_PANEL_ENTER_MS } from './agentPanelStage'

const css = stripComments(
  readFileSync(new URL('./agent-panel.css', import.meta.url), 'utf8'),
)
const full = readFileSync(
  new URL('./AgentPanelFull.tsx', import.meta.url),
  'utf8',
)
const sessions = readFileSync(
  new URL('./AgentPanelSessions.tsx', import.meta.url),
  'utf8',
)
const presence = readFileSync(
  new URL('./useAgentPresence.tsx', import.meta.url),
  'utf8',
)
const pan = readFileSync(
  new URL('./useConversationPan.ts', import.meta.url),
  'utf8',
)

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0, `missing ${start}`)
  assert.ok(to >= 0, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

describe('agent panel motion contract', () => {
  it('keeps open/close duration on the CSS token', () => {
    assert.match(css, /--agent-move:\s*480ms/)
    assert.equal(AGENT_PANEL_ENTER_MS, 480)
    assert.equal(AGENT_ROW_MS, 480)
  })

  it('moves the overlay-anchor as the only open/close object', () => {
    const opening = block(
      css,
      ".agent-panel-overlay-anchor[data-phase='opening'] {",
      ".agent-panel-overlay-anchor[data-phase='closing'] {",
    )
    assert.match(opening, /translate:\s*-50%\s+22px/)
    assert.match(opening, /scale:\s*0\.96/)
    assert.match(opening, /opacity:\s*0/)

    const closing = block(
      css,
      ".agent-panel-overlay-anchor[data-phase='closing'] {",
      '.agent-panel-overlay {',
    )
    assert.match(closing, /translate:\s*-50%\s+22px/)
    assert.match(closing, /--agent-ease-exit/)
  })

  it('opens expanded conversation and history as a rising sheet, not a scaled slab', () => {
    const panel = readFileSync(
      new URL('./AgentPanel.tsx', import.meta.url),
      'utf8',
    )
    assert.match(panel, /data-stage=\{stage\.stage\}/)
    assert.match(
      css,
      /\[data-stage='full'\]\[data-phase='opening'\][\s\S]*translate:\s*-50%\s+0/,
    )
    assert.match(
      css,
      /\[data-stage='full'\]\[data-phase='opening'\][\s\S]*scale:\s*1/,
    )
    assert.match(css, /presence:not\(\[data-kind='row'\]\)/)
    assert.match(pan, /dataset\.phase === 'closing'/)
    assert.match(pan, /conversationShellLimit/)
  })

  it('does not let conversation surfaces run a second open/close', () => {
    assert.doesNotMatch(
      css,
      /\[data-phase='opening'\] \.agent-panel-messages-slot/,
    )
    assert.doesNotMatch(
      css,
      /\[data-phase='closing'\] \.agent-panel-messages-slot/,
    )
    assert.doesNotMatch(css, /\[data-phase='opening'\] \.agent-panel-sessions/)
    assert.doesNotMatch(css, /\[data-phase='closing'\] \.agent-panel-sessions/)
    assert.doesNotMatch(css, /\[data-phase='opening'\] > \.agent-panel-swap/)
  })

  it('centers the sheet with translate -50% so Y motion cannot uncenter it', () => {
    assert.match(
      css,
      /\.agent-panel-overlay-anchor \{[\s\S]*translate:\s*-50%\s+0/,
    )
    assert.doesNotMatch(
      css,
      /\.agent-panel-overlay-anchor \{[\s\S]*?transform:\s*translateX\(-50%\)/,
    )
  })

  it('staggers each conversation and history row as its own motion object', () => {
    assert.match(presence, /--agent-stagger/)
    assert.match(css, /--agent-stagger-step:\s*72ms/)
    assert.match(css, /--agent-row-exit:\s*320ms/)
    assert.match(css, /data-exiting='true'/)
    assert.match(sessions, /from="composer"/)
    assert.match(full, /data-exiting/)
    assert.match(pan, /data-exiting/)
  })

  it('collapses tag chips beside the plus, not the send button', () => {
    const start = block(
      css,
      '@starting-style {',
      ".agent-panel-presence[data-presence='out']",
    )
    assert.match(
      start,
      /\.agent-panel-tag-actions > \.agent-panel-presence\[data-kind='chip'\]/,
    )
    assert.match(
      start,
      /\.agent-panel-composer-tags > \.agent-panel-presence\[data-kind='chip'\]/,
    )
    assert.doesNotMatch(
      start,
      /^\s*\.agent-panel-presence\[data-kind='chip'\] \{/m,
    )
  })

  it('scrolls history with the same pan and blur-exit as chat', () => {
    assert.match(sessions, /useConversationPan/)
    assert.match(sessions, /\.agent-panel-session/)
    assert.doesNotMatch(sessions, /from="clock"/)
    assert.doesNotMatch(full, /agent-panel-session-pager/)
    assert.doesNotMatch(full, /sessions\.prev/)
    assert.doesNotMatch(full, /sessions\.next/)
    assert.match(css, /\.agent-panel-session\[data-leaving='true'\]/)
  })
})
