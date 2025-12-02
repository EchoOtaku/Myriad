/**
 * 详情页视图组件
 * 占位页面，待后续版本实现具体功能
 */

import AnimatedView from '../components/AnimatedView';
import { useI18n } from '../contexts/I18nContext';
import { useDetailsScheduler } from '../hooks/animation/pages/simple';

export default function Details() {
  // 🆕 初始化页面级调度器
  useDetailsScheduler();
  
  const { t } = useI18n();
  
  return (
    <AnimatedView className="min-h-screen px-4 sm:px-6 pt-20 pb-24 md:pb-12">
      <div className="max-w-6xl mx-auto">
        <div className="glass rounded-xl p-6 md:p-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-4">{t.common.details}</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t.common.detailsPlaceholder}
          </p>
        </div>
      </div>
    </AnimatedView>
  );
}
