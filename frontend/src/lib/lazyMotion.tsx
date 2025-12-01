import { useEffect, useState } from 'react';

/**
 * 通用 framer-motion 按需加载工具：在确有动画需求时才动态引入
 * 返回占位元素：未加载时使用原生标签，已加载时使用 motion.*
 */
export function useLazyMotion(shouldAnimate: boolean) {
  const [FM, setFM] = useState<null | { motion: any; AnimatePresence?: any }>(null);

  useEffect(() => {
    let cancelled = false;
    if (shouldAnimate && !FM) {
      import('framer-motion')
        .then((mod) => {
          if (!cancelled) setFM({ motion: mod.motion, AnimatePresence: mod.AnimatePresence });
        })
        .catch(() => {
          // 忽略加载失败，保持静态渲染
        });
    }
    return () => {
      cancelled = true;
    };
  }, [shouldAnimate, FM]);

  const MDiv: any = FM ? FM.motion.div : 'div';
  const MSpan: any = FM ? FM.motion.span : 'span';

  return { motion: FM?.motion, AnimatePresence: FM?.AnimatePresence, MDiv, MSpan } as const;
}
