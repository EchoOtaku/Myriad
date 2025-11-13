/**
 * 初始化设置视图组件
 */

import AnimatedView from '../components/AnimatedView';
import SetupWizard from '../components/SetupWizard';

export default function Setup() {
  return (
    <AnimatedView className="min-h-screen flex items-center justify-center px-4 py-12">
      <SetupWizard />
    </AnimatedView>
  );
}
