/**
 * 页面过渡动画包装器
 * 使用 framer-motion 实现流畅的进入和退出动画
 * 与 AnimatePresence 配合，实现完整的页面切换效果
 */

import { motion } from 'framer-motion';

interface AnimatedViewProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * 页面动画变体配置
 * - 进入: 从下方淡入，带轻微缩放
 * - 退出: 向上淡出，带轻微缩小
 */
const pageVariants = {
  initial: {
    opacity: 0,
    y: 20,
    scale: 0.98,
  },
  enter: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4, // 0.5s → 0.4s (加快20%)
      ease: [0.34, 1.56, 0.64, 1], // 弹性曲线
      staggerChildren: 0.08, // 0.1s → 0.08s (加快20%)
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.98,
    transition: {
      duration: 0.24, // 0.3s → 0.24s (加快20%)
      ease: [0.4, 0, 1, 1], // 快速退出
    },
  },
};

export default function AnimatedView({ children, className = '' }: AnimatedViewProps) {
  return (
    <motion.div
      className={className}
      variants={pageVariants}
      initial="initial"
      animate="enter"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}
