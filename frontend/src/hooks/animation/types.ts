/**
 * 动画协调器类型定义
 */

/** 动画优先级 */
export enum AnimationPriority {
  /** 页面级 - 立即执行，不进队列 */
  PAGE = 0,
  /** 区块级 - 高优先级队列 */
  SECTION = 1,
  /** 组件级 - 普通队列 */
  COMPONENT = 2,
  /** 元素级 - 可延迟/跳过 */
  ELEMENT = 3,
  /** 循环动画 - 独立队列管理 */
  LOOP = 4,
}

/**
 * 循环动画优先级（在 LOOP 队列内部的细分）
 * 数值越小优先级越高
 */
export enum LoopPriority {
  /** 核心循环动画 - 不可被挤占（报告卡片：B站/网易云/GitHub/Steam） */
  CORE = 0,
  /** 普通循环动画 - 可被CORE挤占（其他卡片循环） */
  NORMAL = 1,
  /** 装饰循环动画 - 可被挤占（光晕背景等） */
  DECORATIVE = 2,
}

/** 动画状态 */
export enum AnimationState {
  /** 等待页面就绪 */
  WAITING = 'waiting',
  /** 已调度，等待执行 */
  SCHEDULED = 'scheduled',
  /** 可以开始动画 */
  READY = 'ready',
  /** 动画进行中 */
  RUNNING = 'running',
  /** 动画完成 */
  COMPLETED = 'completed',
  /** 已跳过 */
  SKIPPED = 'skipped',
}

/** 调度策略 */
export enum ScheduleStrategy {
  /** 立即执行，不进队列 */
  IMMEDIATE = 'immediate',
  /** 优先级队列 */
  PRIORITY = 'priority',
  /** 懒执行，视口内才调度 */
  LAZY = 'lazy',
  /** 批量执行 */
  BATCH = 'batch',
}

/** 动画配置 */
export interface AnimationConfig {
  /** 唯一标识 */
  id: string;
  /** 优先级 */
  priority: AnimationPriority;
  /** 分组ID（用于交错动画） */
  groupId?: string;
  /** 在组内的索引 */
  index?: number;
  /** 延迟时间(ms) */
  delay?: number;
  /** 持续时间(ms) */
  duration?: number;
  /** 是否可跳过 */
  canSkip?: boolean;
}

/** 元素动画选项 */
export interface ElementAnimationOptions {
  /** 分组ID */
  groupId?: string;
  /** 在组内的索引 */
  index?: number;
  /** 交错延迟基数(ms) */
  staggerDelay?: number;
  /** 是否等待页面就绪 */
  waitForPage?: boolean;
}

/** 循环动画选项 */
export interface LoopAnimationOptions {
  /** 动画持续时间(ms)，用于调度器计算槽位占用 */
  duration?: number;
  /** 冷却时间(ms)，动画结束后等待多久再重新请求槽位 */
  cooldown?: number;
  /** 循环动画优先级（默认 NORMAL） */
  loopPriority?: LoopPriority;
  /** 是否自动请求槽位 */
  autoRequest?: boolean;
  /** 卸载时是否释放槽位（false则让动画自然完成） */
  releaseOnUnmount?: boolean;
}

/** 监听器类型 */
export type AnimationListener = (state: AnimationState) => void;

/** 取消订阅函数 */
export type Unsubscribe = () => void;

/** 协调器配置 */
export interface CoordinatorConfig {
  /** 基础并发数（稳态） */
  baseConcurrent: number;
  /** 爆发并发数（页面切换/首次加载） */
  burstConcurrent: number;
  /** 爆发持续时间(ms) */
  burstDuration: number;
  /** 循环动画最大槽位数 */
  maxLoopSlots: number;
  /** 最小间隔(ms) */
  minInterval: number;
  /** 默认交错延迟(ms) */
  defaultStaggerDelay: number;
  /** 刷新间隔(ms)，限制RAF频率 */
  flushInterval: number;
}

/** 默认配置 */
export const DEFAULT_CONFIG: CoordinatorConfig = {
  baseConcurrent: 12,       // 稳态最多 12 个并发
  burstConcurrent: 32,      // 爆发时最多 32 个并发
  burstDuration: 5000,      // 爆发持续 5 秒
  maxLoopSlots: 8,          // 循环动画最多 8 个槽位
  minInterval: 16,
  defaultStaggerDelay: 40,  // 略微减少交错延迟，加快首屏
  flushInterval: 16,
};
