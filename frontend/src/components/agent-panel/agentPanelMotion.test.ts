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
import {
  AGENT_PANEL_ENTER_MS,
  AGENT_ROW_EXIT_MS,
  AGENT_ROW_STAGGER_MAX,
  AGENT_ROW_STAGGER_MS,
  agentPanelRowWaveMs,
  agentPanelStaggerSteps,
} from './agentPanelStage'

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
    assert.match(css, /--agent-shell-max:\s*calc\(100dvh \* 2 \/ 3\)/)
    assert.match(css, /max-height:\s*var\(--agent-shell-max\)/)
    assert.match(
      css,
      /\[data-capped='true'\] \{\s*height:\s*var\(--agent-shell-max\)/,
    )
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
    assert.match(presence, /AGENT_ROW_STAGGER_MAX/)
    assert.match(css, /--agent-stagger-step:\s*72ms/)
    assert.match(css, /--agent-stagger-max:\s*8/)
    assert.match(css, /--agent-stagger-wave:\s*9/)
    assert.match(css, /--agent-row-exit:\s*320ms/)
    assert.match(css, /data-exiting='true'/)
    assert.match(css, /:last-child \{\s*margin-bottom:\s*0/)
    assert.match(sessions, /from="composer"/)
    assert.match(sessions, /useAgentSessionList/)
    assert.match(full, /data-exiting/)
    assert.match(full, /setExiting\(false\)/)
    assert.match(full, /agentPanelRowWaveMs\(outgoing\)/)
    assert.doesNotMatch(full, /AGENT_ROW_STAGGER_MS \* 2/)
    assert.doesNotMatch(full, /!zoomed && !exiting/)
    assert.match(full, /held === 'messages'/)
    assert.match(pan, /data-exiting/)
    assert.match(pan, /visibility !== 'hidden'/)
    assert.match(pan, /--agent-exit-stagger/)
    assert.match(pan, /--agent-stagger-wave/)
    assert.doesNotMatch(pan, /mask-image/)
    assert.match(pan, /if \(leaving\) \{[\s\S]*?writeExitStagger\(\)/)
    assert.doesNotMatch(pan, /if \(leaving\) \{\s*clearExit\(\)/)
    assert.match(pan, /conversationHoldExitOnClose/)
    assert.doesNotMatch(pan, /dataset\.leaving !== 'true'/)
    assert.doesNotMatch(pan, /--agent-exit-stagger', '0'/)
    assert.match(
      css,
      /\[data-from='composer'\]:has\(\s*\[data-leaving='true'\]/,
    )
    assert.match(pan, /!nearBottom/)
    assert.match(pan, /wasPinned/)
    assert.match(pan, /conversationExitKey/)
    assert.equal(agentPanelStaggerSteps(2), 2)
    assert.equal(agentPanelStaggerSteps(20), AGENT_ROW_STAGGER_MAX + 1)
    assert.equal(
      agentPanelRowWaveMs(),
      AGENT_ROW_EXIT_MS + AGENT_ROW_STAGGER_MS * (AGENT_ROW_STAGGER_MAX + 1),
    )
    assert.equal(
      agentPanelRowWaveMs(2),
      AGENT_ROW_EXIT_MS + AGENT_ROW_STAGGER_MS * 2,
    )
  })

  it('keeps the composer until the last card has somewhere to return', () => {
    const closingComposer = block(
      css,
      ".agent-panel-overlay-anchor[data-stage='full'][data-phase='closing']\n  .agent-panel-composer {",
      ".agent-panel-overlay-anchor[data-stage='full'][data-phase='closing']\n  .agent-panel-presence[data-kind='row']:not([data-from='face']),",
    )
    assert.match(
      closingComposer,
      /transition-duration:\s*var\(--agent-row-exit\)/,
    )
    assert.match(
      closingComposer,
      /transition-delay:\s*calc\(\s*\(var\(--agent-stagger-wave\) \+ 1\)/,
    )
    assert.doesNotMatch(closingComposer, /3 \* var\(--agent-stagger-step\)/)
    assert.match(css, /--agent-exit-stagger, var\(--agent-stagger, 0\)/)
  })

  it('lets full-stage rows enter at move duration and leave at row-exit', () => {
    assert.doesNotMatch(
      css,
      /\[data-stage='full'\] \.agent-panel-composer,\s*\n\s*\.agent-panel-overlay-anchor\[data-stage='full'\]/,
    )
    assert.match(
      css,
      /\[data-phase='closing'\][\s\S]*?transition-duration:\s*var\(--agent-row-exit\)/,
    )
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

  it('lights the bottom of the screen while the panel is open', () => {
    const panel = readFileSync(
      new URL('./AgentPanel.tsx', import.meta.url),
      'utf8',
    )
    assert.match(panel, /className="agent-panel-aurora"/)
    assert.match(panel, /className="agent-panel-aurora-flow"/)
    assert.match(panel, /className="agent-panel-aurora-prism"/)
    assert.doesNotMatch(panel, /agent-panel-aurora-prism-rev/)
    assert.match(panel, /useAgentAuroraPrism/)
    assert.match(panel, /AgentPanelAurora/)
    assert.match(panel, /useAgentMessageCount/)
    assert.match(panel, /prismARef/)
    assert.match(panel, /prismBRef/)
    const prism = readFileSync(
      new URL('./useAgentAuroraPrism.ts', import.meta.url),
      'utf8',
    )
    assert.match(prism, /PRISM_HANDOFF_MS = 340/)
    assert.match(prism, /PRISM_CLEAR_MS = 720/)
    assert.match(prism, /\[live, layerA, layerB\]/)
    assert.doesNotMatch(prism, /\[status, enabled, layerA, layerB\]/)
    assert.match(panel, /className="agent-panel-aurora-alert"/)
    assert.match(panel, /data-status=\{status\}/)
    assert.match(panel, /useAgentStatus/)
    assert.match(panel, /aria-hidden="true"/)
    assert.match(css, /\.agent-panel-aurora \{/)
    assert.match(css, /z-index:\s*60/)
    assert.match(css, /@keyframes agent-panel-aurora-drift/)
    assert.match(css, /@keyframes agent-panel-aurora-drift-cross/)
    assert.match(css, /@keyframes agent-panel-aurora-ribbon/)
    assert.match(css, /--agent-aurora-0:\s*var\(--color-primary\)/)
    assert.match(css, /90deg in oklch/)
    assert.match(css, /oklch\(\s*from var\(--color-primary\)/)
    assert.match(css, /calc\(h \+ 40deg\)/)
    assert.match(css, /calc\(h \+ 120deg\)/)
    assert.match(css, /--agent-aurora-width:\s*400%/)
    assert.match(css, /--agent-aurora-band-height:\s*88px/)
    assert.match(css, /--agent-aurora-band-bottom:\s*-28px/)
    assert.match(css, /@property --agent-aurora-0/)
    assert.match(css, /\.agent-panel-aurora-prism \{/)
    assert.match(css, /\.agent-panel-aurora-alert \{/)
    assert.doesNotMatch(css, /@keyframes agent-panel-aurora-wander/)
    assert.match(css, /@keyframes agent-panel-aurora-blob-a/)
    assert.match(css, /@keyframes agent-panel-aurora-blob-d/)
    assert.match(css, /\.agent-panel-aurora-blob \{/)
    assert.match(css, /--blob-path/)
    assert.match(css, /--blob-stagger/)
    assert.doesNotMatch(css, /--prism-ribbon/)
    assert.doesNotMatch(css, /agent-panel-aurora-prism-rev/)
    assert.match(css, /\[data-active='true'\]/)
    assert.doesNotMatch(css, /var\(--p0\) 19%/)
    assert.doesNotMatch(css, /oklch\(78% 0\.26 18deg\)/)
    assert.doesNotMatch(css, /--p5:/)
    assert.match(
      css,
      /\[data-status='thinking'\][\s\S]*?\.agent-panel-aurora-prism\[data-active='true'\][\s\S]*?opacity:\s*1/,
    )
    assert.match(
      css,
      /\[data-status='error'\] \.agent-panel-aurora-alert[\s\S]*opacity:\s*1/,
    )
    assert.match(css, /\[data-status='error'\][\s\S]*--color-error/)
    assert.doesNotMatch(css, /oklch\(72% 0\.24 0deg\)/)
    assert.doesNotMatch(css, /oklch\(72% 0\.24 60deg\)/)
    assert.doesNotMatch(css, /longer hue/)
    assert.doesNotMatch(css, /#5bcefa/)
    assert.match(
      css,
      /prefers-reduced-motion: reduce[\s\S]*\.agent-panel-aurora,/,
    )
    assert.match(css, /contain:\s*layout paint/)
    assert.match(css, /\[data-paused='true'\]/)
    assert.match(css, /animation-play-state:\s*paused/)
    assert.doesNotMatch(css, /data-from='clock'/)
    assert.doesNotMatch(css, /data-from='place'/)
    assert.doesNotMatch(presence, /'clock'/)
    assert.match(panel, /stage\.phase !== 'opening'/)
    assert.match(panel, /stage\.phase !== 'closing'/)
    assert.match(panel, /auroraRef/)
    assert.match(presence, /staggerFor\.current\.delete/)
  })

  it('scrolls history with the same pan and fade-exit as chat', () => {
    assert.match(sessions, /useConversationPan/)
    assert.match(sessions, /\.agent-panel-session/)
    assert.doesNotMatch(sessions, /from="clock"/)
    assert.doesNotMatch(full, /agent-panel-session-pager/)
    assert.doesNotMatch(full, /sessions\.prev/)
    assert.doesNotMatch(full, /sessions\.next/)
    assert.match(css, /\.agent-panel-session\[data-leaving='true'\]/)
    assert.match(
      css,
      /html \.agent-panel-message-body\.glass,\s*\n\s*html \.agent-panel-session\.glass \{[\s\S]*?backdrop-filter:\s*none/,
    )
    assert.match(
      css,
      /html:not\(\[data-surface='solid'\]\) \.agent-panel-message-body\.glass[\s\S]*?--surface-alpha:\s*84%/,
    )
    assert.match(
      css,
      /\.agent-panel-message\[data-leaving='true'\],\s*\n\s*\.agent-panel-session\[data-leaving='true'\] \{[\s\S]*?filter:\s*opacity\(/,
    )
    assert.doesNotMatch(
      css,
      /\.agent-panel-message\[data-leaving='true'\][\s\S]*?blur\(calc\(var\(--exit/,
    )
  })
})
