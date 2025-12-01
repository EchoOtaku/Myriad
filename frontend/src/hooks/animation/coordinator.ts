/**
 * 动画协调器核心类
 * 
 * 设计原则：
 * 1. 单一 RAF 循环，批量更新
 * 2. 页面级事件驱动，元素级队列调度
 * 3. Ref 存储状态，最小化渲染
 * 4. 支持优先级抢占和跳过
 * 5. 并发控制，限制同时运行的动画数量
 * 6. WeakRef 元素追踪，自动 GC 释放（可选）
 */

import {
  AnimationState,
  AnimationPriority,
  LoopPriority,
  AnimationConfig,
  AnimationListener,
  Unsubscribe,
  CoordinatorConfig,
  DEFAULT_CONFIG,
} from './types';

/** 动画槽位信息 */
interface AnimationSlot {
  id: string;
  priority: AnimationPriority;
  startTime: number;
  duration: number;
}

/** 循环动画槽位信息（共享主队列） */
interface LoopSlot {
  id: string;
  loopPriority: LoopPriority;
  startTime: number;
  duration: number;
  cooldown: number;
  timerId: ReturnType<typeof setTimeout> | null;
}

/** 循环动画等待项 */
interface LoopWaitingItem {
  id: string;
  loopPriority: LoopPriority;
  duration: number;
  cooldown: number;
  registeredAt: number;
}

/** 等待队列项 */
interface WaitingItem {
  id: string;
  priority: AnimationPriority;
  delay: number;
  index: number;
  groupId?: string;
  registeredAt: number;
}

/** 🔧 WeakRef 元素追踪项 */
interface WeakRefEntry {
  ref: WeakRef<HTMLElement>;
  animationId: string;
}

class AnimationCoordinator {
  private config: CoordinatorConfig;
  
  // 状态存储（非响应式）
  private states = new Map<string, AnimationState>();
  
  // 事件订阅
  private listeners = new Map<string, Set<AnimationListener>>();
  
  // 页面就绪状态
  private currentPageId: string | null = null;
  private pageReadyResolve: (() => void) | null = null;
  private pageReadyPromise: Promise<void> | null = null;
  private isPageReady = false;
  
  // 页面就绪回调队列
  private pageReadyCallbacks = new Set<() => void>();
  
  // 批量更新（使用 microtask 而非 RAF）
  private pendingUpdates = new Set<string>();
  private isMicrotaskScheduled = false;
  
  // ==================== 并发控制 ====================
  // 活动动画槽位
  private activeSlots = new Map<string, AnimationSlot>();
  // 等待队列（按优先级排序）
  private waitingQueue: WaitingItem[] = [];
  // 上次启动时间（用于最小间隔控制）
  private lastStartTime = 0;
  
  // ==================== 爆发模式 ====================
  // 爆发模式开始时间
  private burstStartTime: number = 0;
  // 是否处于爆发模式
  private inBurstMode: boolean = false;
  // 爆发模式持续时间（动态调整）
  private currentBurstDuration: number = 0;
  
  // ==================== 超时清理 ====================
  // 动画超时时间(ms)，超时后自动释放槽位
  private readonly ANIMATION_TIMEOUT = 2000;
  // 超时检查定时器
  private timeoutCheckerId: ReturnType<typeof setInterval> | null = null;
  
  // ==================== 循环动画队列 ====================
  // 循环动画槽位追踪（共享主队列 activeSlots，这里只记录循环动画的额外信息）
  private loopSlots = new Map<string, LoopSlot>();
  // 循环动画等待队列（按 LoopPriority 排序）
  private loopWaitingQueue: LoopWaitingItem[] = [];
  // 冷却中的循环动画（等待重新进入队列）
  private loopCooldowns = new Map<string, { cooldownEnd: number; duration: number; cooldown: number; loopPriority: LoopPriority }>();
  
  // 延迟队列
  private delayedQueue: Array<{ id: string; executeAt: number; priority: AnimationPriority }> = [];
  private delayTimerId: ReturnType<typeof setTimeout> | null = null;
  
  // ==================== 分片处理配置 ====================
  // 每批最大处理数，避免 Long Task
  private readonly BATCH_SIZE = 8;
  // 分片延迟（让出主线程）
  private readonly YIELD_DELAY = 0;
  
  // ==================== WeakRef 元素追踪（内存优化）====================
  // 🔧 新增：使用 WeakRef 追踪元素，元素被 GC 时自动清理状态
  private elementRefs = new Map<string, WeakRefEntry>();
  // FinalizationRegistry 用于自动清理
  private finalizationRegistry: FinalizationRegistry<string> | null = null;
  // WeakRef 清理检查间隔
  private weakRefCheckerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // 启动超时检查器
    this.startTimeoutChecker();
    // 📌 初始化时立即进入超频模式，确保首屏动画流畅
    this.activateBurstMode(10000);
    // 🔧 初始化 FinalizationRegistry（如果浏览器支持）
    this.initFinalizationRegistry();
  }
  
  // ==================== WeakRef 元素追踪 ====================
  
  /**
   * 🔧 初始化 FinalizationRegistry
   * 用于在元素被 GC 时自动清理相关状态
   */
  private initFinalizationRegistry() {
    if (typeof FinalizationRegistry !== 'undefined') {
      this.finalizationRegistry = new FinalizationRegistry<string>((animationId) => {
        // 元素被 GC，清理相关状态
        this.cleanupAnimationState(animationId);
      });
    }
    
    // 备用方案：定期检查 WeakRef（用于不支持 FinalizationRegistry 的环境）
    this.startWeakRefChecker();
  }
  
  /**
   * 🔧 启动 WeakRef 定期检查器
   * 作为 FinalizationRegistry 的备用方案
   */
  private startWeakRefChecker() {
    if (this.weakRefCheckerId) return;
    
    // 每 30 秒检查一次（低频率，避免性能影响）
    this.weakRefCheckerId = setInterval(() => {
      this.checkAndCleanupWeakRefs();
    }, 30000);
  }
  
  /**
   * 🔧 检查并清理已失效的 WeakRef
   */
  private checkAndCleanupWeakRefs() {
    if (this.elementRefs.size === 0) return;
    
    const toCleanup: string[] = [];
    
    for (const [id, entry] of this.elementRefs) {
      const element = entry.ref.deref();
      if (!element) {
        // WeakRef 已失效，元素已被 GC
        toCleanup.push(id);
      }
    }
    
    // 批量清理
    for (const id of toCleanup) {
      this.cleanupAnimationState(id);
    }
  }
  
  /**
   * 🔧 注册元素引用（可选 API）
   * 允许组件注册 DOM 元素，实现自动内存管理
   * 
   * @param animationId 动画 ID
   * @param element DOM 元素
   */
  registerElement(animationId: string, element: HTMLElement) {
    // 清理旧引用
    const oldEntry = this.elementRefs.get(animationId);
    if (oldEntry && this.finalizationRegistry) {
      // 无法取消注册旧元素，但新注册会覆盖
    }
    
    // 创建新的 WeakRef
    const ref = new WeakRef(element);
    this.elementRefs.set(animationId, { ref, animationId });
    
    // 注册到 FinalizationRegistry
    if (this.finalizationRegistry) {
      this.finalizationRegistry.register(element, animationId);
    }
  }
  
  /**
   * 🔧 取消元素注册
   * 
   * @param animationId 动画 ID
   */
  unregisterElement(animationId: string) {
    const entry = this.elementRefs.get(animationId);
    if (entry) {
      // 无法从 FinalizationRegistry 取消注册，但删除 elementRefs 条目
      this.elementRefs.delete(animationId);
    }
  }
  
  /**
   * 🔧 检查元素是否仍然存在
   * 
   * @param animationId 动画 ID
   * @returns 元素是否存在
   */
  isElementAlive(animationId: string): boolean {
    const entry = this.elementRefs.get(animationId);
    if (!entry) return true; // 未注册元素，假设存在
    
    const element = entry.ref.deref();
    return element !== undefined;
  }
  
  /**
   * 🔧 清理动画状态（内部使用）
   */
  private cleanupAnimationState(animationId: string) {
    // 从 elementRefs 移除
    this.elementRefs.delete(animationId);
    
    // 清理状态
    this.states.delete(animationId);
    this.listeners.delete(animationId);
    this.pendingUpdates.delete(animationId);
    
    // 释放槽位
    if (this.activeSlots.has(animationId)) {
      this.activeSlots.delete(animationId);
      this.processWaitQueue();
    }
    
    // 清理循环动画
    const loopInfo = this.loopSlots.get(animationId);
    if (loopInfo) {
      if (loopInfo.timerId) {
        clearTimeout(loopInfo.timerId);
      }
      this.loopSlots.delete(animationId);
    }
    this.loopCooldowns.delete(animationId);
    
    // 从等待队列移除
    const waitIdx = this.waitingQueue.findIndex(item => item.id === animationId);
    if (waitIdx !== -1) {
      this.waitingQueue.splice(waitIdx, 1);
    }
    
    const loopWaitIdx = this.loopWaitingQueue.findIndex(item => item.id === animationId);
    if (loopWaitIdx !== -1) {
      this.loopWaitingQueue.splice(loopWaitIdx, 1);
    }
    
    // 从延迟队列移除
    const delayIdx = this.delayedQueue.findIndex(item => item.id === animationId);
    if (delayIdx !== -1) {
      this.delayedQueue.splice(delayIdx, 1);
    }
  }
  
  // ==================== 超时清理 ====================
  
  /**
   * 启动超时检查器
   * 定期检查并清理超时的动画槽位
   * 🔧 优化：页面不可见时暂停检查，节省 CPU
   */
  private startTimeoutChecker() {
    if (this.timeoutCheckerId) return;
    
    this.timeoutCheckerId = setInterval(() => {
      // 🔧 页面不可见时跳过检查
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      this.cleanupTimedOutSlots();
    }, 1000); // 每1000ms检查一次，减少CPU开销
  }
  
  /**
   * 清理超时的槽位 - 优化版：减少数组创建
   */
  private cleanupTimedOutSlots() {
    // 快速返回：无活动槽位
    if (this.activeSlots.size === 0) return;
    
    const now = performance.now();
    let hasTimedOut = false;
    
    for (const [id, slot] of this.activeSlots) {
      // 循环动画不受超时限制（由 scheduleLoopRelease 管理）
      if (slot.priority === AnimationPriority.LOOP) continue;
      
      // 检查是否超时
      if (now - slot.startTime > this.ANIMATION_TIMEOUT) {
        this.activeSlots.delete(id);
        this.states.set(id, AnimationState.COMPLETED);
        hasTimedOut = true;
      }
    }
    
    // 如果有释放，处理等待队列
    if (hasTimedOut) {
      this.processWaitQueue();
    }
  }
  
  // ==================== 动态并发控制 ====================
  
  /**
   * 获取当前最大并发数 - 优化版：减少计算开销
   */
  private getMaxConcurrent(): number {
    // 快速路径：爆发模式
    if (this.inBurstMode) {
      const elapsed = performance.now() - this.burstStartTime;
      if (elapsed < this.currentBurstDuration) {
        return this.config.burstConcurrent;
      }
      // 爆发模式到期
      this.inBurstMode = false;
    }
    
    return this.config.baseConcurrent;
  }
  
  /**
   * 检查并触发爆发模式（仅在需要时调用）
   */
  private checkAndTriggerBurst() {
    if (this.inBurstMode) return;
    
    const totalQueued = this.waitingQueue.length + this.delayedQueue.length;
    if (totalQueued > Math.ceil(this.config.baseConcurrent * 0.5)) {
      this.activateBurstMode(this.config.burstDuration);
    }
  }
  
  /**
   * 激活爆发模式
   * @param duration 爆发持续时间
   */
  private activateBurstMode(duration: number) {
    this.inBurstMode = true;
    this.burstStartTime = performance.now();
    this.currentBurstDuration = duration;
  }
  
  /**
   * 延长爆发模式
   */
  private extendBurstMode() {
    // 每次延长一个基础周期
    this.burstStartTime = performance.now();
    this.currentBurstDuration = this.config.burstDuration;
  }

  // ==================== 配置 ====================
  
  updateConfig(config: Partial<CoordinatorConfig>) {
    this.config = { ...this.config, ...config };
  }

  // ==================== 页面级（事件驱动）====================

  /**
   * 开始页面过渡
   */
  startPageTransition(pageId: string) {
    // 清理旧页面状态
    if (this.currentPageId && this.currentPageId !== pageId) {
      this.cleanupPage(this.currentPageId);
    }
    
    this.currentPageId = pageId;
    this.isPageReady = false;
    
    // 激活爆发模式（页面切换时使用更长的持续时间 10s）
    this.activateBurstMode(10000);
    
    // 创建新的 Promise
    this.pageReadyPromise = new Promise(resolve => {
      this.pageReadyResolve = resolve;
    });
  }

  /**
   * 完成页面过渡 - 分片版：避免 Long Task
   * 🔧 优化：避免创建临时数组，直接迭代 Set
   */
  completePageTransition() {
    this.isPageReady = true;
    
    // 解析 Promise
    this.pageReadyResolve?.();
    this.pageReadyResolve = null;
    
    // 触发所有等待的回调（分片处理）
    const callbackCount = this.pageReadyCallbacks.size;
    if (callbackCount > 0) {
      // 小批量直接处理（避免创建数组）
      if (callbackCount <= this.BATCH_SIZE) {
        // 先保存引用再清空，防止回调中添加新回调
        const callbacks = this.pageReadyCallbacks;
        this.pageReadyCallbacks = new Set();
        queueMicrotask(() => {
          for (const cb of callbacks) {
            cb();
          }
        });
      } else {
        // 大批量：需要转数组以支持分片索引
        const callbacks = Array.from(this.pageReadyCallbacks);
        this.pageReadyCallbacks.clear();
        
        let index = 0;
        const processBatch = () => {
          const end = Math.min(index + this.BATCH_SIZE, callbacks.length);
          for (; index < end; index++) {
            callbacks[index]();
          }
          if (index < callbacks.length) {
            setTimeout(processBatch, this.YIELD_DELAY);
          }
        };
        queueMicrotask(processBatch);
      }
    }
    
    // 处理延迟队列
    this.processDelayedQueue();
  }

  /**
   * 等待页面就绪
   */
  async waitForPage(): Promise<void> {
    if (this.isPageReady) {
      return Promise.resolve();
    }
    return this.pageReadyPromise ?? Promise.resolve();
  }

  /**
   * 注册页面就绪回调
   */
  onPageReady(callback: () => void): Unsubscribe {
    if (this.isPageReady) {
      queueMicrotask(callback);
      return () => {};
    }
    
    this.pageReadyCallbacks.add(callback);
    return () => this.pageReadyCallbacks.delete(callback);
  }

  /**
   * 获取页面就绪状态
   */
  getPageReadyState(): boolean {
    return this.isPageReady;
  }

  /**
   * 清理页面状态 - 优化版：直接清空而非迭代
   */
  private cleanupPage(_pageId: string) {
    // 直接清空所有状态，避免迭代开销
    this.states.clear();
    this.listeners.clear();
    this.pendingUpdates.clear();
    this.isMicrotaskScheduled = false;
    
    // 清理延迟队列
    this.delayedQueue = [];
    if (this.delayTimerId) {
      clearTimeout(this.delayTimerId);
      this.delayTimerId = null;
    }
    
    // 清理并发控制队列
    this.activeSlots.clear();
    this.waitingQueue = [];
    
    // 清理循环动画队列和定时器
    for (const slot of this.loopSlots.values()) {
      if (slot.timerId) {
        clearTimeout(slot.timerId);
      }
    }
    this.loopSlots.clear();
    this.loopWaitingQueue = [];
    this.loopCooldowns.clear();
  }

  // ==================== 元素级（批量调度）====================

  /**
   * 调度动画
   */
  schedule(config: AnimationConfig): AnimationState {
    const { id, priority, delay = 0, index = 0, groupId } = config;
    
    // 页面级：立即就绪（不受并发限制）
    if (priority === AnimationPriority.PAGE) {
      this.states.set(id, AnimationState.READY);
      return AnimationState.READY;
    }
    
    // 非页面级：检查页面就绪状态
    if (!this.isPageReady) {
      this.states.set(id, AnimationState.WAITING);
      
      // 注册页面就绪回调
      this.onPageReady(() => {
        this.scheduleAfterPageReady(id, delay, index, groupId, priority);
      });
      
      return AnimationState.WAITING;
    }
    
    // 页面已就绪，直接调度
    return this.scheduleAfterPageReady(id, delay, index, groupId, priority);
  }

  /**
   * 页面就绪后调度
   */
  private scheduleAfterPageReady(
    id: string, 
    delay: number, 
    index: number,
    groupId?: string,
    priority: AnimationPriority = AnimationPriority.COMPONENT
  ): AnimationState {
    // 计算交错延迟
    const staggerDelay = groupId ? index * this.config.defaultStaggerDelay : 0;
    const totalDelay = delay + staggerDelay;
    
    if (totalDelay > 0) {
      // 加入延迟队列
      this.states.set(id, AnimationState.SCHEDULED);
      this.addToDelayedQueue(id, totalDelay, priority);
      return AnimationState.SCHEDULED;
    }
    
    // 无延迟，尝试获取槽位
    return this.tryAcquireSlot(id, priority);
  }

  /**
   * 尝试获取并发槽位
   */
  private tryAcquireSlot(id: string, priority: AnimationPriority): AnimationState {
    const maxConcurrent = this.getMaxConcurrent();
    
    // 检查是否有可用槽位
    if (this.activeSlots.size < maxConcurrent) {
      // 有空闲槽位，直接获取
      this.acquireSlot(id, priority);
      this.markReady(id);
      return AnimationState.READY;
    }
    
    // 槽位已满，检查是否可以抢占
    if (this.canPreempt(priority)) {
      // 抢占最低优先级的槽位
      this.preemptLowestPriority(id, priority);
      return AnimationState.READY;
    }
    
    // 加入等待队列
    this.addToWaitQueue(id, priority);
    return AnimationState.SCHEDULED;
  }

  /**
   * 获取槽位 - 优化版：缓存时间戳
   */
  private acquireSlot(id: string, priority: AnimationPriority) {
    const now = performance.now();
    this.activeSlots.set(id, {
      id,
      priority,
      startTime: now,
      duration: 0
    });
    this.lastStartTime = now;
  }

  /**
   * 检查是否可以抢占 - 优化版：添加快速返回
   */
  private canPreempt(priority: AnimationPriority): boolean {
    // 只有高优先级可以抢占（数值越小优先级越高）
    if (priority > AnimationPriority.SECTION) return false;
    
    // 快速返回：没有活动槽位
    if (this.activeSlots.size === 0) return false;
    
    // 检查是否有可抢占的低优先级项
    for (const slot of this.activeSlots.values()) {
      if (slot.priority > priority) {
        return true;
      }
    }
    return false;
  }

  /**
   * 抢占最低优先级槽位
   */
  private preemptLowestPriority(id: string, priority: AnimationPriority) {
    // 找到最低优先级的槽位
    let lowestPriority = -1;
    let victimId: string | null = null;
    
    for (const slot of this.activeSlots.values()) {
      if (slot.priority > lowestPriority) {
        lowestPriority = slot.priority;
        victimId = slot.id;
      }
    }
    
    if (victimId) {
      // 跳过被抢占的动画
      this.releaseSlot(victimId);
      this.skip(victimId);
      
      // 获取槽位
      this.acquireSlot(id, priority);
      this.markReady(id);
    }
  }

  /**
   * 添加到等待队列 - 优化版：二分插入避免排序
   */
  private addToWaitQueue(id: string, priority: AnimationPriority) {
    this.states.set(id, AnimationState.SCHEDULED);
    
    const item: WaitingItem = {
      id,
      priority,
      delay: 0,
      index: 0,
      registeredAt: performance.now()
    };
    
    // 二分查找插入位置（优先级数值小的在前）
    let left = 0;
    let right = this.waitingQueue.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (this.waitingQueue[mid].priority <= priority) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    this.waitingQueue.splice(left, 0, item);
  }

  /**
   * 释放槽位
   */
  private releaseSlot(id: string) {
    this.activeSlots.delete(id);
  }

  /**
   * 处理等待队列 - 分片版：避免 Long Task
   */
  private processWaitQueue() {
    // 队列有压力时触发爆发模式
    if (this.waitingQueue.length > 0) {
      this.checkAndTriggerBurst();
    }
    
    const maxConcurrent = this.getMaxConcurrent();
    let processed = 0;
    
    while (
      this.waitingQueue.length > 0 &&
      this.activeSlots.size < maxConcurrent &&
      processed < this.BATCH_SIZE
    ) {
      const next = this.waitingQueue.shift();
      if (next) {
        this.acquireSlot(next.id, next.priority);
        this.markReady(next.id);
        processed++;
      }
    }
    
    // 如果还有剩余且有槽位，延迟继续处理
    if (this.waitingQueue.length > 0 && this.activeSlots.size < maxConcurrent) {
      setTimeout(() => this.processWaitQueue(), this.YIELD_DELAY);
    }
  }

  /**
   * 添加到延迟队列 - 优化版：二分插入避免排序
   */
  private addToDelayedQueue(id: string, delay: number, priority: AnimationPriority = AnimationPriority.COMPONENT) {
    const executeAt = performance.now() + delay;
    const item = { id, executeAt, priority };
    
    // 二分查找插入位置（按执行时间升序）
    let left = 0;
    let right = this.delayedQueue.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (this.delayedQueue[mid].executeAt <= executeAt) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    this.delayedQueue.splice(left, 0, item);
    
    // 调度下一个
    this.scheduleNextDelay();
  }

  /**
   * 调度下一个延迟项
   */
  private scheduleNextDelay() {
    if (this.delayTimerId || this.delayedQueue.length === 0) return;
    
    const next = this.delayedQueue[0];
    const now = performance.now();
    const wait = Math.max(0, next.executeAt - now);
    
    this.delayTimerId = setTimeout(() => {
      this.delayTimerId = null;
      this.processDelayedQueue();
    }, wait);
  }

  /**
   * 处理延迟队列
   */
  private processDelayedQueue() {
    const now = performance.now();
    
    // 处理所有到期项
    while (this.delayedQueue.length > 0) {
      const next = this.delayedQueue[0];
      if (next.executeAt > now) break;
      
      this.delayedQueue.shift();
      // 到期后尝试获取槽位
      this.tryAcquireSlot(next.id, next.priority);
    }
    
    // 调度下一个
    this.scheduleNextDelay();
  }

  /**
   * 标记为就绪 - 优化版：使用 microtask 批处理
   */
  private markReady(id: string) {
    this.states.set(id, AnimationState.READY);
    this.pendingUpdates.add(id);
    this.scheduleMicrotaskFlush();
  }

  /**
   * 标记动画开始（外部调用，表示动画真正开始播放）
   * 注意：槽位应该已经在 schedule 时获取
   */
  markRunning(id: string) {
    this.states.set(id, AnimationState.RUNNING);
  }

  /**
   * 标记动画完成
   */
  markCompleted(id: string) {
    this.states.set(id, AnimationState.COMPLETED);
    
    // 释放槽位
    if (this.activeSlots.has(id)) {
      this.releaseSlot(id);
      
      // 处理等待队列中的下一个
      this.processWaitQueue();
    }
  }

  /**
   * 跳过动画
   */
  skip(id: string) {
    this.states.set(id, AnimationState.SKIPPED);
    
    // 释放槽位（如果有）
    if (this.activeSlots.has(id)) {
      this.releaseSlot(id);
      this.processWaitQueue();
    }
    
    this.pendingUpdates.add(id);
    this.scheduleMicrotaskFlush();
  }

  // ==================== 循环动画支持（共享主队列）====================

  /**
   * 请求循环动画槽位
   * 循环动画与普通动画共享主队列槽位
   * 支持按 LoopPriority 优先级抢占
   * 动画结束后自动释放槽位，冷却后重新加入队列
   * 
   * @param id 动画唯一标识
   * @param duration 动画持续时间(ms)，结束后释放槽位
   * @param cooldown 冷却时间(ms)，释放后等待多久再重新请求
   * @param loopPriority 循环动画优先级（CORE > NORMAL > DECORATIVE）
   * @returns 是否成功获取槽位
   */
  requestLoopSlot(
    id: string, 
    duration: number = 3000, 
    cooldown: number = 10000,
    loopPriority: LoopPriority = LoopPriority.NORMAL
  ): boolean {
    // 如果正在冷却中，不允许请求
    if (this.loopCooldowns.has(id)) {
      return false;
    }
    
    // 如果已经在运行，返回 true
    if (this.loopSlots.has(id)) {
      return true;
    }
    
    // 🔧 优化：如果已经在等待队列中，直接返回 false，避免重复添加
    if (this.states.get(id) === AnimationState.SCHEDULED) {
      return false;
    }
    
    // 从等待队列移除（优化：使用 findIndex + splice 避免创建新数组）
    const waitIdx = this.loopWaitingQueue.findIndex(item => item.id === id);
    if (waitIdx !== -1) {
      this.loopWaitingQueue.splice(waitIdx, 1);
    }
    
    const maxConcurrent = this.getMaxConcurrent();
    const maxLoopSlots = this.config.maxLoopSlots;
    
    // 检查循环动画槽位是否已满
    const loopSlotsFull = this.loopSlots.size >= maxLoopSlots;
    
    // 检查主队列是否有可用槽位，且循环动画槽位未满
    if (this.activeSlots.size < maxConcurrent && !loopSlotsFull) {
      this.acquireLoopSlot(id, loopPriority, duration, cooldown);
      return true;
    }
    
    // 循环动画槽位满，检查是否可以抢占其他循环动画
    if (loopSlotsFull) {
      const victimId = this.findLoopPreemptVictim(loopPriority);
      if (victimId) {
        // 抢占低优先级循环动画槽位
        this.forceReleaseLoopSlot(victimId);
        this.acquireLoopSlot(id, loopPriority, duration, cooldown);
        return true;
      }
    }
    
    // 无法抢占，加入等待队列
    this.addToLoopWaitQueue(id, loopPriority, duration, cooldown);
    return false;
  }

  /**
   * 获取循环动画槽位（共享主队列）- 优化版：缓存时间戳
   */
  private acquireLoopSlot(id: string, loopPriority: LoopPriority, duration: number, cooldown: number) {
    const now = performance.now();
    
    // 在主队列获取槽位
    this.activeSlots.set(id, {
      id,
      priority: AnimationPriority.LOOP,
      startTime: now,
      duration,
    });
    
    // 记录循环动画额外信息
    const timerId = setTimeout(() => {
      this.onLoopAnimationComplete(id);
    }, duration);
    
    this.loopSlots.set(id, {
      id,
      loopPriority,
      startTime: now,
      duration,
      cooldown,
      timerId,
    });
    
    this.states.set(id, AnimationState.RUNNING);
    this.notify(id, AnimationState.RUNNING);
  }

  /**
   * 循环动画完成回调
   * 释放槽位，进入冷却期，然后重新加入队列
   */
  private onLoopAnimationComplete(id: string) {
    const loopInfo = this.loopSlots.get(id);
    if (!loopInfo) return;
    
    // 释放主队列槽位
    this.activeSlots.delete(id);
    this.loopSlots.delete(id);
    
    // 通知动画完成（暂时）
    this.states.set(id, AnimationState.COMPLETED);
    this.notify(id, AnimationState.COMPLETED);
    
    // 处理等待队列
    this.processWaitQueue();
    this.processLoopWaitQueue();
    
    // 进入冷却期，冷却结束后重新加入队列
    if (loopInfo.cooldown > 0) {
      const cooldownEnd = performance.now() + loopInfo.cooldown;
      this.loopCooldowns.set(id, {
        cooldownEnd,
        duration: loopInfo.duration,
        cooldown: loopInfo.cooldown,
        loopPriority: loopInfo.loopPriority,
      });
      
      // 冷却结束后重新请求
      setTimeout(() => {
        this.onLoopCooldownComplete(id);
      }, loopInfo.cooldown);
    }
  }

  /**
   * 循环动画冷却完成，重新加入队列
   */
  private onLoopCooldownComplete(id: string) {
    const cooldownInfo = this.loopCooldowns.get(id);
    if (!cooldownInfo) return;
    
    this.loopCooldowns.delete(id);
    
    // 检查组件是否还在监听（如果没有监听器了，说明组件已卸载）
    if (!this.listeners.has(id)) {
      return;
    }
    
    // 重新请求槽位
    this.requestLoopSlot(id, cooldownInfo.duration, cooldownInfo.cooldown, cooldownInfo.loopPriority);
  }

  /**
   * 寻找可抢占的循环动画槽位
   * CORE 不能被抢占，DECORATIVE 最容易被抢占
   */
  private findLoopPreemptVictim(requestingPriority: LoopPriority): string | null {
    if (requestingPriority === LoopPriority.DECORATIVE) {
      return null; // DECORATIVE 不能抢占
    }
    
    let bestVictim: { id: string; priority: LoopPriority; startTime: number } | null = null;
    
    for (const slot of this.loopSlots.values()) {
      // CORE 不能被抢占
      if (slot.loopPriority === LoopPriority.CORE) {
        continue;
      }
      
      // 检查是否可以抢占
      if (requestingPriority < slot.loopPriority) {
        if (!bestVictim || slot.startTime < bestVictim.startTime) {
          bestVictim = { id: slot.id, priority: slot.loopPriority, startTime: slot.startTime };
        }
      }
    }
    
    return bestVictim?.id ?? null;
  }

  /**
   * 添加到循环动画等待队列 - 优化版：二分插入 + 状态检查
   */
  private addToLoopWaitQueue(id: string, loopPriority: LoopPriority, duration: number, cooldown: number) {
    // 如果已经在调度中，跳过（使用状态检查替代 some 遍历）
    if (this.states.get(id) === AnimationState.SCHEDULED) {
      return;
    }
    
    this.states.set(id, AnimationState.SCHEDULED);
    
    const item: LoopWaitingItem = {
      id,
      loopPriority,
      duration,
      cooldown,
      registeredAt: performance.now(),
    };
    
    // 二分查找插入位置（优先级数值小的在前，同优先级按注册时间）
    let left = 0;
    let right = this.loopWaitingQueue.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      const midItem = this.loopWaitingQueue[mid];
      const shouldInsertAfter = midItem.loopPriority < loopPriority || 
        (midItem.loopPriority === loopPriority && midItem.registeredAt <= item.registeredAt);
      if (shouldInsertAfter) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    this.loopWaitingQueue.splice(left, 0, item);
  }

  /**
   * 处理循环动画等待队列 - 优化版：预计算限制
   */
  private processLoopWaitQueue() {
    // 快速返回：无等待项
    if (this.loopWaitingQueue.length === 0) return;
    
    const maxConcurrent = this.getMaxConcurrent();
    const maxLoopSlots = this.config.maxLoopSlots;
    
    // 预计算可用槽位数
    let availableConcurrent = maxConcurrent - this.activeSlots.size;
    let availableLoopSlots = maxLoopSlots - this.loopSlots.size;
    
    while (
      this.loopWaitingQueue.length > 0 &&
      availableConcurrent > 0 &&
      availableLoopSlots > 0
    ) {
      const next = this.loopWaitingQueue.shift();
      if (next) {
        this.acquireLoopSlot(next.id, next.loopPriority, next.duration, next.cooldown);
        availableConcurrent--;
        availableLoopSlots--;
      }
    }
  }

  /**
   * 强制释放循环动画槽位（被抢占时调用）
   */
  private forceReleaseLoopSlot(id: string) {
    const loopInfo = this.loopSlots.get(id);
    if (!loopInfo) return;
    
    // 清除定时器
    if (loopInfo.timerId) {
      clearTimeout(loopInfo.timerId);
    }
    
    // 释放槽位
    this.activeSlots.delete(id);
    this.loopSlots.delete(id);
    
    this.states.set(id, AnimationState.SKIPPED);
    this.notify(id, AnimationState.SKIPPED);
    
    // 被抢占后也进入冷却期
    if (loopInfo.cooldown > 0) {
      this.loopCooldowns.set(id, {
        cooldownEnd: performance.now() + loopInfo.cooldown,
        duration: loopInfo.duration,
        cooldown: loopInfo.cooldown,
        loopPriority: loopInfo.loopPriority,
      });
      
      setTimeout(() => {
        this.onLoopCooldownComplete(id);
      }, loopInfo.cooldown);
    }
  }

  /**
   * 释放循环动画槽位（组件卸载时调用）- 优化版：减少数组创建
   */
  releaseLoopSlot(id: string) {
    const loopInfo = this.loopSlots.get(id);
    if (loopInfo) {
      if (loopInfo.timerId) {
        clearTimeout(loopInfo.timerId);
      }
      this.activeSlots.delete(id);
      this.loopSlots.delete(id);
      this.states.set(id, AnimationState.COMPLETED);
      this.notify(id, AnimationState.COMPLETED);
      
      this.processWaitQueue();
      this.processLoopWaitQueue();
    }
    
    // 清除冷却状态
    this.loopCooldowns.delete(id);
    
    // 从等待队列移除（使用 findIndex + splice 避免创建新数组）
    const idx = this.loopWaitingQueue.findIndex(item => item.id === id);
    if (idx !== -1) {
      this.loopWaitingQueue.splice(idx, 1);
    }
  }

  /**
   * 检查循环动画是否活跃
   */
  isLoopActive(id: string): boolean {
    return this.loopSlots.has(id);
  }

  /**
   * 获取循环动画槽位状态（用于调试）
   */
  getLoopSlotStatus() {
    const slots: { id: string; priority: string; runningTime: number }[] = [];
    const now = performance.now();
    
    for (const slot of this.loopSlots.values()) {
      slots.push({
        id: slot.id,
        priority: LoopPriority[slot.loopPriority],
        runningTime: Math.round(now - slot.startTime),
      });
    }
    
    return {
      activeLoopSlots: this.loopSlots.size,
      maxLoopSlots: this.config.maxLoopSlots,
      totalActiveSlots: this.activeSlots.size,
      maxConcurrent: this.getMaxConcurrent(),
      waitingQueue: this.loopWaitingQueue.length,
      cooldownCount: this.loopCooldowns.size,
      slots,
      waiting: this.loopWaitingQueue.map(item => ({
        id: item.id,
        priority: LoopPriority[item.loopPriority],
      })),
    };
  }

  // ==================== 批量更新（microtask 替代 RAF）====================

  /**
   * 调度 microtask 刷新
   * microtask 在当前任务结束后立即执行，不会计入 RAF 计数
   */
  private scheduleMicrotaskFlush() {
    if (this.isMicrotaskScheduled) return;
    this.isMicrotaskScheduled = true;
    
    queueMicrotask(() => {
      this.isMicrotaskScheduled = false;
      this.flushPendingUpdates();
    });
  }

  /**
   * 刷新待更新项 - 分片版：避免 Long Task
   */
  private flushPendingUpdates() {
    if (this.pendingUpdates.size === 0) return;
    
    // 小批量直接处理
    if (this.pendingUpdates.size <= this.BATCH_SIZE) {
      for (const id of this.pendingUpdates) {
        const state = this.states.get(id);
        if (state) {
          this.notify(id, state);
        }
      }
      this.pendingUpdates.clear();
      return;
    }
    
    // 大批量分片处理
    const ids = Array.from(this.pendingUpdates);
    this.pendingUpdates.clear();
    
    let index = 0;
    const processBatch = () => {
      const end = Math.min(index + this.BATCH_SIZE, ids.length);
      for (; index < end; index++) {
        const id = ids[index];
        const state = this.states.get(id);
        if (state) {
          this.notify(id, state);
        }
      }
      
      if (index < ids.length) {
        setTimeout(processBatch, this.YIELD_DELAY);
      }
    };
    
    processBatch();
  }

  // ==================== 订阅 ====================

  /**
   * 订阅状态变化 - 优化版：减少 Map 查找
   */
  subscribe(id: string, callback: AnimationListener): Unsubscribe {
    let listenerSet = this.listeners.get(id);
    if (!listenerSet) {
      listenerSet = new Set();
      this.listeners.set(id, listenerSet);
    }
    listenerSet.add(callback);
    
    // 如果已有状态，立即通知（microtask）
    const state = this.states.get(id);
    if (state) {
      queueMicrotask(() => callback(state));
    }
    
    return () => {
      const listeners = this.listeners.get(id);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.listeners.delete(id);
          // 🔧 修复：同时清理废弃的状态，避免内存泄漏
          this.states.delete(id);
          this.pendingUpdates.delete(id);
        }
      }
    };
  }

  /**
   * 通知监听器 - 优化版：直接迭代避免闭包
   */
  private notify(id: string, state: AnimationState) {
    const listeners = this.listeners.get(id);
    if (listeners) {
      for (const cb of listeners) {
        cb(state);
      }
    }
  }

  /**
   * 获取状态
   */
  getState(id: string): AnimationState | undefined {
    return this.states.get(id);
  }

  // ==================== 工具方法 ====================

  /**
   * 计算交错延迟
   */
  getStaggerDelay(index: number, baseDelay?: number): number {
    return index * (baseDelay ?? this.config.defaultStaggerDelay);
  }

  /**
   * 获取活动动画数（占用槽位数）
   */
  getActiveCount(): number {
    return this.activeSlots.size;
  }

  /**
   * 获取负载（0-1）- 优化版：避免除零
   */
  getLoad(): number {
    const max = this.inBurstMode ? this.config.burstConcurrent : this.config.baseConcurrent;
    return this.activeSlots.size / max;
  }

  /**
   * 获取等待队列长度
   */
  getWaitingCount(): number {
    return this.waitingQueue.length;
  }

  /**
   * 🔧 新增：获取内存使用状态（用于监控内存泄漏）
   */
  getMemoryStatus() {
    return {
      statesSize: this.states.size,
      listenersSize: this.listeners.size,
      pendingUpdatesSize: this.pendingUpdates.size,
      pageReadyCallbacksSize: this.pageReadyCallbacks.size,
      activeSlotsSize: this.activeSlots.size,
      waitingQueueLength: this.waitingQueue.length,
      delayedQueueLength: this.delayedQueue.length,
      loopSlotsSize: this.loopSlots.size,
      loopWaitingQueueLength: this.loopWaitingQueue.length,
      loopCooldownsSize: this.loopCooldowns.size,
      // 🔧 新增：WeakRef 追踪的元素数量
      trackedElementsCount: this.elementRefs.size,
      // 总计：超过 500 可能有泄漏
      totalEntries: this.states.size + this.listeners.size + this.activeSlots.size + 
                    this.waitingQueue.length + this.delayedQueue.length +
                    this.loopSlots.size + this.loopWaitingQueue.length + this.loopCooldowns.size +
                    this.elementRefs.size,
    };
  }

  /**
   * 获取并发状态（用于调试）
   */
  getConcurrencyStatus() {
    const maxConcurrent = this.getMaxConcurrent();
    const totalQueued = this.waitingQueue.length + this.delayedQueue.length;
    const pressureThreshold = Math.ceil(this.config.baseConcurrent * 0.5);
    
    return {
      activeSlots: this.activeSlots.size,
      maxConcurrent,
      inBurstMode: this.inBurstMode,
      burstTimeRemaining: this.inBurstMode 
        ? Math.max(0, this.currentBurstDuration - (performance.now() - this.burstStartTime))
        : 0,
      waitingQueue: this.waitingQueue.length,
      delayedQueue: this.delayedQueue.length,
      totalQueued,
      queuePressure: totalQueued > pressureThreshold,
      load: this.activeSlots.size / maxConcurrent,
    };
  }

  /**
   * 重置协调器
   */
  reset() {
    this.states.clear();
    this.listeners.clear();
    this.pendingUpdates.clear();
    this.pageReadyCallbacks.clear();
    this.delayedQueue = [];
    this.isMicrotaskScheduled = false;
    
    // 清理并发控制
    this.activeSlots.clear();
    this.waitingQueue = [];
    
    // 清理循环动画队列和定时器
    for (const slot of this.loopSlots.values()) {
      if (slot.timerId) {
        clearTimeout(slot.timerId);
      }
    }
    this.loopSlots.clear();
    this.loopWaitingQueue = [];
    this.loopCooldowns.clear();
    
    // 重置爆发模式
    this.inBurstMode = false;
    this.burstStartTime = 0;
    this.currentBurstDuration = 0;
    
    if (this.delayTimerId) {
      clearTimeout(this.delayTimerId);
      this.delayTimerId = null;
    }
    
    this.isPageReady = false;
    this.currentPageId = null;
  }
  
  /**
   * 手动激活爆发模式（用于首次加载）
   */
  triggerBurst() {
    this.activateBurstMode(10000); // 首次加载也使用10s
  }
  
  /**
   * 销毁协调器（清理定时器）
   */
  destroy() {
    this.reset();
    if (this.timeoutCheckerId) {
      clearInterval(this.timeoutCheckerId);
      this.timeoutCheckerId = null;
    }
    // 🔧 清理 WeakRef 检查器
    if (this.weakRefCheckerId) {
      clearInterval(this.weakRefCheckerId);
      this.weakRefCheckerId = null;
    }
    // 清理 elementRefs
    this.elementRefs.clear();
  }
}

// 单例导出
export const coordinator = new AnimationCoordinator();

// 注意：构造函数中已自动激活超频模式，无需手动调用 triggerBurst

export default AnimationCoordinator;
