/**
 * 登录视图组件
 */

import AnimatedView from '../components/AnimatedView';
import LoginForm from '../components/LoginForm';

export default function Login() {
  return (
    <AnimatedView className="min-h-screen flex items-center justify-center px-4 py-12">
      <LoginForm />
    </AnimatedView>
  );
}
