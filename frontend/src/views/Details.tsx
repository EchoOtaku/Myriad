/**
 * 详情页视图组件
 * TODO: 需要根据具体的详情页内容进行实现
 */

import AnimatedView from '../components/AnimatedView';

export default function Details() {
  return (
    <AnimatedView className="min-h-screen px-4 sm:px-6 py-8 md:py-12 pb-24 md:pb-12">
      <div className="max-w-6xl mx-auto">
        <div className="glass rounded-xl p-6 md:p-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-4">详情页</h1>
          <p className="text-gray-600 dark:text-gray-400">
            详情页内容将在这里显示
          </p>
        </div>
      </div>
    </AnimatedView>
  );
}
