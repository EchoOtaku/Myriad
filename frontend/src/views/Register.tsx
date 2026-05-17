/**
 * 注册视图组件（PR #4）
 */

import AnimatedView from '../components/AnimatedView'
import RegisterForm from '../components/RegisterForm'
import { useLoginScheduler } from '../hooks/animation'

export default function Register() {
  // 复用登录页的调度器（同样是简易入场动画）
  useLoginScheduler()

  return (
    <AnimatedView className="min-h-screen flex items-center justify-center px-4 pt-20">
      <RegisterForm />
    </AnimatedView>
  )
}
