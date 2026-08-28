/**
 * 三档展开的状态机。
 *
 * 岛 → Quick Overlay → Full 是同一块东西的三个大小，不是三个页面，所以「现在是
 * 哪一档」和「正在变形吗」得分开记：变形途中两档的内容可能同时在场，收起动画
 * 没播完就把内容卸载会硬切。
 *
 * 没有复用顶部控制面板那套 —— 它是为「顶部小条长成大面板」调的，锚点、方向、
 * 还要和导航岛交接的情况都不一样。但它踩过的坑照搬了两条：
 * - 变形途中冻结悬停效果，否则鼠标扫过会抖
 * - 动画结束事件可能丢，必须有超时兜底，不能让状态卡在变形中
 */

/** 展开到第几档。`full` 还没落地，先占位。 */
export type AgentPanelStage = 'island' | 'overlay' | 'full'

export type AgentPanelPhase = 'settled' | 'opening' | 'closing'

export interface AgentPanelStageState {
  stage: AgentPanelStage
  phase: AgentPanelPhase
}

export type AgentPanelStageAction =
  | { type: 'open'; stage: Exclude<AgentPanelStage, 'island'> }
  | { type: 'close' }
  | { type: 'toggle'; stage: Exclude<AgentPanelStage, 'island'> }
  /** 动画播完（transitionend 或超时兜底） */
  | { type: 'settle' }

export const INITIAL_AGENT_PANEL_STAGE: AgentPanelStageState = {
  stage: 'island',
  phase: 'settled',
}

/** 展开/收起动画时长，和 CSS 里那条 transition 对齐。 */
export const AGENT_PANEL_MORPH_MS = 260

/** 等 transitionend 的宽限。丢事件时靠它把状态推回 settled。 */
export const AGENT_PANEL_SETTLE_SLACK_MS = 120

export function agentPanelStageReducer(
  state: AgentPanelStageState,
  action: AgentPanelStageAction,
): AgentPanelStageState {
  switch (action.type) {
    case 'open': {
      // 已经在这一档就别重播动画 —— 重复长按不该让面板闪一下
      if (state.stage === action.stage && state.phase !== 'closing') {
        return state.phase === 'settled'
          ? state
          : { stage: action.stage, phase: 'opening' }
      }
      return { stage: action.stage, phase: 'opening' }
    }

    case 'toggle':
      return state.stage === action.stage && state.phase !== 'closing'
        ? agentPanelStageReducer(state, { type: 'close' })
        : agentPanelStageReducer(state, { type: 'open', stage: action.stage })

    case 'close': {
      if (state.stage === 'island') return state
      // 收起时先留在原档演动画，settle 之后才真的回到岛
      return { stage: state.stage, phase: 'closing' }
    }

    case 'settle':
      if (state.phase === 'settled') return state
      return state.phase === 'closing'
        ? INITIAL_AGENT_PANEL_STAGE
        : { stage: state.stage, phase: 'settled' }

    default:
      return state
  }
}

/** 内容是否还该留在 DOM 里（收起动画期间仍然要留）。 */
export function agentPanelShowsStage(
  state: AgentPanelStageState,
  stage: Exclude<AgentPanelStage, 'island'>,
): boolean {
  return state.stage === stage
}

/** 展开着（含正在展开）—— 用来决定要不要接管键盘、点外部收起。 */
export function agentPanelIsOpen(state: AgentPanelStageState): boolean {
  return state.stage !== 'island' && state.phase !== 'closing'
}

/** 变形途中：冻结悬停，免得鼠标扫过时抖。 */
export function agentPanelIsMorphing(state: AgentPanelStageState): boolean {
  return state.phase !== 'settled'
}

/** 超时兜底的等待时长。 */
export function agentPanelSettleTimeoutMs(): number {
  return AGENT_PANEL_MORPH_MS + AGENT_PANEL_SETTLE_SLACK_MS
}
