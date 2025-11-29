/**
 * 账户管理视图组件
 */

import { useState, useEffect } from 'react';
import AnimatedView from '../components/AnimatedView';

import { getCSRFToken } from '../utils/csrf';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import TokenManager from '../utils/tokenManager';
import { getUserAvatarWithCache } from '../utils/userInfoCache';

interface User {
  username: string;
  is_admin: boolean;
  auth_provider: string;
  display_name?: string;
  linked_github_id?: string;
}

export default function Account() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 加载账户信息
  useEffect(() => {
    async function checkAuth() {
      // ✅ 直接调用 API 验证（不再手动检查 token，因为 HttpOnly Cookie 无法被 JS 读取）
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: 'include', // ✅ 自动发送 HttpOnly Cookie
        });

        if (!response.ok) {
          throw new Error('Failed to fetch user info');
        }

        const userData = await response.json();
        setUser(userData);

        // 获取头像（使用缓存）
        try {
          const avatar = await getUserAvatarWithCache(userData.username);
          setAvatarUrl(avatar);
        } catch (e) {
          setAvatarUrl(`https://ui-avatars.com/api/?name=${userData.username}`);
        }

        // 只有本地账户且未绑定 GitHub 才显示修改密码
        setShowChangePassword(userData.auth_provider === 'local' && !userData.linked_github_id);
      } catch (error) {
        navigate('/login', { replace: true });
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [navigate]);

  // 处理修改密码
  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError('');

    const formData = new FormData(e.currentTarget);
    const oldPassword = formData.get('old-password') as string;
    const newPassword = formData.get('new-password') as string;
    const confirmPassword = formData.get('confirm-password') as string;

    if (newPassword.length < 8) {
      setPasswordError('新密码至少需要 8 个字符');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }

    if (oldPassword === newPassword) {
      setPasswordError('新密码不能与当前密码相同');
      return;
    }

    setSubmitting(true);

    try {
      // 获取 CSRF Token
      const csrfToken = await getCSRFToken(true);
      if (!csrfToken) {
        setPasswordError('无法获取 CSRF Token，请刷新页面后重试');
        setSubmitting(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert('✅ 密码修改成功!');
        setPasswordError('');
        e.currentTarget.reset();
      } else {
        setPasswordError(result.message || result.error || '修改失败，请重试');
      }
    } catch (error) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return null;
  }

  return (
    <AnimatedView className="min-h-screen px-4 sm:px-6 pt-20 pb-24 md:pb-12">
      <div className="max-w-6xl mx-auto">
        {/* 账户信息卡片 */}
        <div className="mb-4 md:mb-6">
          <div className="glass rounded-xl p-4 md:p-5">
            <div className="flex items-start justify-between gap-4 md:gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3 md:mb-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 flex items-center justify-center text-xl sm:text-2xl">
                    馃懁
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">账户信息</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">GitHub 账户绑定与登录状态</p>
                  </div>
                </div>

                {user && (
                  <div className="bg-white/50 dark:bg-gray-800/50 rounded-lg p-3 md:p-4 border border-gray-200/50 dark:border-gray-700/50">
                    <div className="flex items-center gap-4">
                      <img 
                        src={avatarUrl} 
                        className="w-16 h-16 rounded-full shadow-md" 
                        alt={user.username}
                        onError={(e) => { 
                          e.currentTarget.src = `https://ui-avatars.com/api/?name=${user.username}`; 
                        }}
                      />
                      <div className="flex-1">
                        <p className="font-bold text-gray-800 text-lg">{user.username}</p>
                        <p className="text-sm text-gray-600 mt-0.5">
                          {user.is_admin ? '🤵 管理员' : '🙂 普通用户'} · {user.auth_provider === 'local' ? '本地账户' : 'GitHub 账户'}
                        </p>
                        {user.display_name && (
                          <p className="text-xs text-gray-500 mt-1">显示名称: {user.display_name}</p>
                        )}
                      </div>

                      {user.auth_provider === 'local' && !user.linked_github_id && (
                        <a 
                          href={`${API_URL}/api/auth/github/link`}
                          className="px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg flex items-center gap-2 transition-all duration-300 text-sm font-semibold shadow-md"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd"/>
                          </svg>
                          绑定 GitHub
                        </a>
                      )}

                      {user.linked_github_id && (
                        <div className="flex items-center gap-2 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
                          <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                          </svg>
                          <div className="text-sm">
                            <p className="text-green-700 font-semibold">已绑定 GitHub</p>
                            <p className="text-green-600 text-xs">本地登录已启用</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 修改密码卡片 */}
        {showChangePassword && (
          <div className="mb-4 md:mb-6">
            <div className="glass rounded-xl p-4 md:p-5">
              <div className="flex items-center gap-3 mb-3 md:mb-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/50 dark:to-pink-900/50 flex items-center justify-center text-xl sm:text-2xl">
                  馃攼
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">修改密码</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">修改本地账户登录密码</p>
                </div>
              </div>

              <form onSubmit={handleChangePassword} className="bg-white/50 dark:bg-gray-800/50 rounded-lg p-3 md:p-4 border border-gray-200/50 dark:border-gray-700/50">
                <div className="space-y-3 md:space-y-4">
                  <div>
                    <label htmlFor="old-password" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      当前密码
                    </label>
                    <input
                      type="password"
                      id="old-password"
                      name="old-password"
                      required
                      className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[44px]"
                      placeholder="请输入当前密码"
                    />
                  </div>

                  <div>
                    <label htmlFor="new-password" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      新密码
                    </label>
                    <input
                      type="password"
                      id="new-password"
                      name="new-password"
                      required
                      minLength={8}
                      className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[44px]"
                      placeholder="至少 8 个字符"
                    />
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      确认新密码
                    </label>
                    <input
                      type="password"
                      id="confirm-password"
                      name="confirm-password"
                      required
                      minLength={8}
                      className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[44px]"
                      placeholder="再次输入新密码"
                    />
                  </div>

                  {passwordError && (
                    <div className="text-red-500 dark:text-red-400 text-xs sm:text-sm">
                      {passwordError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full px-4 py-3 text-sm sm:text-base bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white font-semibold rounded-lg transition-all duration-300 shadow-md min-h-[44px] disabled:opacity-50"
                  >
                    {submitting ? '修改中...' : '修改密码'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AnimatedView>
  );
}

