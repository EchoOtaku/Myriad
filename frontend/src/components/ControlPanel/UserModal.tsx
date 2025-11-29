import React, { useState } from 'react';
import { API_URL } from '../../config';
import { getCSRFToken } from '../../utils/csrf';

interface User {
  username: string;
  is_admin: boolean;
  auth_provider: string;
  display_name?: string;
  linked_github_id?: string;
}

interface UserInfo {
  name: string;
  avatar: string;
  bio: string;
  platform: string;
}

interface UserModalProps {
  user: User;
  userInfo: UserInfo;
  isClosing: boolean;
  onClose: () => void;
  onLogout: () => void;
}

/**
 * 用户信息弹窗组件（已登录状态）
 * 显示用户详细信息、修改密码、绑定GitHub等功能
 */
export const UserModal: React.FC<UserModalProps> = ({
  user,
  userInfo,
  isClosing,
  onClose,
  onLogout,
}) => {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  // 处理修改密码
  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
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

    setPasswordSubmitting(true);

    try {
      // 获取 CSRF Token
      const csrfToken = await getCSRFToken(true);
      if (!csrfToken) {
        setPasswordError('无法获取 CSRF Token，请刷新页面后重试');
        setPasswordSubmitting(false);
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
        alert('✓ 密码修改成功！');
        e.currentTarget.reset();
        setShowChangePassword(false);
      } else {
        setPasswordError(result.message || result.error || '修改失败，请重试');
      }
    } catch (error) {
      setPasswordError('网络错误，请稍后重试');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  return (
    <div className={`user-modal ${isClosing ? 'closing' : ''}`}>
      <div className="user-modal-header">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">用户信息</h3>
        <button
          onClick={onClose}
          className="control-close-btn"
          aria-label="关闭"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="user-modal-content">
        <div className="user-profile-section max-w-md mx-auto">
          <div className="user-profile-header">
            <img
              src={userInfo.avatar}
              alt={userInfo.name}
              className="user-profile-avatar"
              onError={(e) => {
                e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userInfo.name)}`;
              }}
            />
            <div className="user-profile-info">
              <h4 className="user-profile-name">{userInfo.name}</h4>
              <p className="user-profile-platform">来自 {userInfo.platform}</p>
            </div>
          </div>

          <div className="user-profile-bio">
            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">个人简介</h5>
            <p className="text-sm text-gray-600 dark:text-gray-400">{userInfo.bio}</p>
          </div>

          <div className="user-profile-meta">
            <div className="user-meta-item">
              <span className="user-meta-label">账户</span>
              <span className="user-meta-value">{user.username}</span>
            </div>
            <div className="user-meta-item">
              <span className="user-meta-label">角色</span>
              <span className="user-meta-value">
                {user.is_admin ? '👑 管理员' : '👤 普通用户'}
              </span>
            </div>
            <div className="user-meta-item">
              <span className="user-meta-label">认证方式</span>
              <span className="user-meta-value">{user.auth_provider}</span>
            </div>
            {user.linked_github_id && (
              <div className="user-meta-item">
                <span className="user-meta-label">GitHub</span>
                <span className="user-meta-value text-green-600 dark:text-green-400">✓ 已绑定</span>
              </div>
            )}
          </div>

          {/* 绑定 GitHub 按钮 */}
          {user.auth_provider === 'local' && !user.linked_github_id && (
            <a
              href={`${API_URL}/api/auth/github/link`}
              className="user-action-btn user-action-github"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd"/>
              </svg>
              绑定 GitHub 账户
            </a>
          )}

          {/* 修改密码按钮（仅本地账户且未绑定GitHub） */}
          {user.auth_provider === 'local' && !user.linked_github_id && (
            <>
              {!showChangePassword ? (
                <button
                  onClick={() => setShowChangePassword(true)}
                  className="user-action-btn user-action-secondary"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  修改密码
                </button>
              ) : (
                <div className="change-password-form">
                  <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">修改密码</h5>
                  <form onSubmit={handleChangePassword} className="space-y-3">
                    <div>
                      <label htmlFor="old-password" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        当前密码
                      </label>
                      <input
                        type="password"
                        id="old-password"
                        name="old-password"
                        required
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder="请输入当前密码"
                      />
                    </div>
                    <div>
                      <label htmlFor="new-password" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        新密码
                      </label>
                      <input
                        type="password"
                        id="new-password"
                        name="new-password"
                        required
                        minLength={8}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder="至少 8 个字符"
                      />
                    </div>
                    <div>
                      <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        确认新密码
                      </label>
                      <input
                        type="password"
                        id="confirm-password"
                        name="confirm-password"
                        required
                        minLength={8}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder="再次输入新密码"
                      />
                    </div>
                    {passwordError && (
                      <div className="text-red-500 dark:text-red-400 text-xs">
                        {passwordError}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={passwordSubmitting}
                        className="flex-1 px-3 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-all disabled:opacity-50"
                      >
                        {passwordSubmitting ? '修改中...' : '确认修改'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowChangePassword(false);
                          setPasswordError('');
                        }}
                        className="px-3 py-2 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-all"
                      >
                        取消
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </>
          )}

          <button
            onClick={onLogout}
            className="user-logout-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserModal;
