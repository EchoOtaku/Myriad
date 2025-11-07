import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { FaUser, FaLock, FaSpinner, FaGithub } from 'react-icons/fa';
import { fetchJson } from '../utils/apiHelper';
import { RateLimitError } from '../utils/rateLimiter';
import { sanitizeUsername } from '../utils/inputSanitizer';

const LoginForm: React.FC = () => {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [githubEnabled, setGithubEnabled] = useState(false);

  useEffect(() => {
    checkGithubOAuth();
  }, []);

  const checkGithubOAuth = async () => {
    try {
      const data = await fetchJson(`${API_URL}/api/setup/config`);
      setGithubEnabled(data.github_oauth?.client_id_set || false);
    } catch (err) {
      // Failed to check GitHub OAuth config
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 输入验证
    if (!formData.username || !formData.password) {
      setError('请填写用户名和密码');
      return;
    }

    // 验证用户名格式
    if (formData.username.length < 3 || formData.username.length > 50) {
      setError('用户名长度应为3-50个字符');
      return;
    }

    // 验证用户名只包含字母、数字、下划线
    if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      setError('用户名只能包含字母、数字和下划线');
      return;
    }

    // 验证密码长度
    if (formData.password.length < 8 || formData.password.length > 128) {
      setError('密码长度应为8-128个字符');
      return;
    }

    setSubmitting(true);

    try {
      const data = await fetchJson(
        `${API_URL}/api/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(formData),
        },
        '登录失败'
      );
      
      // Validate response data
      if (!data.token || typeof data.token !== 'string' || data.token.length < 10) {
        throw new Error('登录响应数据不完整');
      }

      if (!data.user || typeof data.user !== 'object') {
        throw new Error('用户信息不完整');
      }

      // Validate token format (should be JWT)
      const tokenParts = data.token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('无效的token格式');
      }

      // Save JWT token
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('user_info', JSON.stringify(data.user));

      // 触发自定义事件通知Layout更新用户信息
      window.dispatchEvent(new CustomEvent('auth-login-success', { 
        detail: { user: data.user, token: data.token } 
      }));

      // 延迟一下再跳转，让事件处理器先执行
      setTimeout(() => {
        window.location.href = '/';
      }, 100);
    } catch (err: any) {
      // 处理 Rate Limit 错误
      if (err instanceof RateLimitError) {
        const seconds = Math.ceil(err.retryAfter / 1000);
        setError(`登录尝试过于频繁，请在 ${seconds} 秒后重试`);
      } else {
        setError(err.message || '登录失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-2xl shadow-xl p-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Local Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              用户名
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <FaUser className="text-gray-400" />
              </div>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => {
                  const sanitized = sanitizeUsername(e.target.value);
                  setFormData({ ...formData, username: sanitized });
                }}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="输入用户名"
                maxLength={50}
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              密码
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <FaLock className="text-gray-400" />
              </div>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="输入密码"
                maxLength={128}
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg"
          >
            {submitting ? (
              <>
                <FaSpinner className="animate-spin" />
                <span>登录中...</span>
              </>
            ) : (
              <span>登录</span>
            )}
          </button>
        </form>

        {/* GitHub OAuth Option */}
        {githubEnabled && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">或</span>
              </div>
            </div>

            <a
              href={`${API_URL}/api/auth/github/login`}
              className="w-full py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 font-semibold shadow-md"
            >
              <FaGithub className="text-xl" />
              <span>使用 GitHub 登录</span>
            </a>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginForm;
