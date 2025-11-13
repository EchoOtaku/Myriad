/**
 * 资料库视图组件
 * 显示用户的多平台数据收藏
 */

import LibraryGrid from '../components/LibraryGrid';
import AnimatedView from '../components/AnimatedView';

export default function Library() {
  return (
    <AnimatedView className="min-h-screen px-3 xs:px-4 sm:px-6 py-8 sm:py-12 pb-28 sm:pb-24 md:pb-12">
      <div className="max-w-7xl mx-auto">
        <LibraryGrid />
      </div>
    </AnimatedView>
  );
}
