/**
 * 动画协调系统
 * 
 * 统一管理所有页面和元素动画的调度
 * 
 * 核心特性：
 * - 页面级动画：立即执行，完成后通知子元素
 * - 元素级动画：等待页面就绪，支持交错延迟
 * - 单一 RAF 循环：批量更新，避免性能问题
 * - 事件驱动：无轮询，最小化开销
 * 
 * @example
 * ```tsx
 * // 页面组件
 * function PageView({ children }) {
 *   const { isReady, onEnterComplete } = usePageTransition({ pageId: 'home' });
 *   return (
 *     <motion.div
 *       animate={isReady ? 'enter' : 'initial'}
 *       onAnimationComplete={onEnterComplete}
 *     >
 *       {children}
 *     </motion.div>
 *   );
 * }
 * 
 * // 列表项
 * function ListItem({ index }) {
 *   const { canAnimate, delay } = useStaggerAnimation({ groupId: 'list', index });
 *   return (
 *     <motion.div
 *       animate={canAnimate ? { opacity: 1 } : { opacity: 0 }}
 *       transition={{ delay: delay / 1000 }}
 *     />
 *   );
 * }
 * 
 * // 简单使用
 * function Card() {
 *   const isPageReady = usePageReady();
 *   return <div className={isPageReady ? 'visible' : 'hidden'} />;
 * }
 * ```
 */

// 导出类型
export type {
  AnimationConfig,
  ElementAnimationOptions,
  LoopAnimationOptions,
  AnimationListener,
  Unsubscribe,
  CoordinatorConfig,
} from './types';

export {
  AnimationPriority,
  AnimationState,
  ScheduleStrategy,
  LoopPriority,
  DEFAULT_CONFIG,
} from './types';

// 导出协调器
export { coordinator } from './coordinator';
export { default as AnimationCoordinator } from './coordinator';

// 导出 Hooks
export { usePageTransition } from './usePageTransition';
export { useElementAnimation } from './useElementAnimation';
export { useStaggerAnimation } from './useStaggerAnimation';
export { usePageReady } from './usePageReady';
export { useLoopAnimation } from './useLoopAnimation';
export { 
  useVisibilityAwareAnimation,
  useVisibilityObserver,
  type VisibilityAwareAnimationOptions,
  type VisibilityAwareAnimationResult,
  type VisibilityObserverOptions,
  type VisibilityObserverResult,
} from './useVisibilityAwareAnimation';

// 便捷函数
import { coordinator } from './coordinator';

/**
 * 重置页面动画状态
 * 用于路由切换时调用
 */
export function resetPageAnimationState() {
  // 通过 coordinator 处理，它会在 startPageTransition 时清理
}

/**
 * 配置协调器
 */
export function configureAnimationCoordinator(config: Partial<import('./types').CoordinatorConfig>) {
  coordinator.updateConfig(config);
}
