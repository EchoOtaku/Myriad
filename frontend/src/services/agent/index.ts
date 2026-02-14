/**
 * Agent 服务模块
 *
 * AI 驱动的自然语言任务编排系统前端接口
 */

// 导出类型
export type {
  // 上下文
  ProcessContext,
  ProcessRequest,
  ClarifyRequest,

  // 任务
  TaskStatus,
  TaskInfo,
  TaskDetail,

  // 澄清
  ClarificationType,
  ClarificationPoint,

  // 响应
  AgentResponseType,
  AgentResponse,

  // SSE 事件
  TaskCreatedEvent,
  StepStartedEvent,
  StepCompletedEvent,
  ProgressUpdateEvent,
  TaskCompletedEvent,
  WaitingForInputEvent,
  ErrorEvent,
  ProgressEvent,
  ProgressCallback,

  // 数据展示
  ColumnDef,
  DataDisplayHint,

  // 前端动作
  FrontendActionType,
  WindowTarget,
  PageElementTarget,
  InteractionCommand,
  ScrollOptions,
  WaitCondition,
  ReadingListPayload,
  FrontendAction,

  // 能力
  Capability,

  // 预设
  PresetType,
  TaskPreset,
  TaskPresetListResponse,
  CreatePresetRequest,
  ConversationMessage,

  // 会话
  SessionInfo,
  SessionMessage,
} from './types';

// 导出 API 服务
export { agentService } from './agentApi';

// 导出前端动作处理器
export type { FrontendActionHandler } from './frontendActions';
export {
  registerActionHandler,
  unregisterActionHandler,
  executeFrontendAction,
  hasActionHandler,
  getRegisteredActionTypes,
  clearAllHandlers,
} from './frontendActions';

// ============ 便捷函数 ============

import type { AgentResponse, ProcessContext, ProgressCallback } from './types';

import { agentService } from './agentApi';

/**
 * 快捷处理函数
 */
export async function ask(
  input: string,
  context?: Partial<ProcessContext>
): Promise<AgentResponse> {
  return agentService.process(input, context);
}

/**
 * 对话处理函数（可以传入对话历史上下文）
 */
export async function chat(
  input: string,
  context?: Partial<ProcessContext>
): Promise<AgentResponse> {
  return agentService.process(input, context);
}

/**
 * 带实时进度更新的处理函数
 */
export async function askWithProgress(
  input: string,
  onProgress: ProgressCallback,
  context?: Partial<ProcessContext>
): Promise<AgentResponse> {
  return agentService.processWithProgress(input, onProgress, context);
}
