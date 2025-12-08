import React, { useState, useEffect } from 'react';
import { API_URL } from '../../config';
import { getCSRFToken } from '../../utils/csrf';
import { useI18n } from '../../contexts/I18nContext';
import { listTapps, type TappListItem } from '../../tapp/services/TappApiService';
import { useNavigate } from 'react-router-dom';
import '../UserModal.css';

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
 * 全新设计：头像居中、信息整合、浮动关闭按钮
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
  const [tapps, setTapps] = useState<TappListItem[]>([]);
  const [tappsLoading, setTappsLoading] = useState(true);
  const { t } = useI18n();
  const navigate = useNavigate();

  // 加载 Tapp 列表
  useEffect(() => {
    const loadTapps = async () => {
      try {
        const list = await listTapps();
        setTapps(list);
      } catch (error) {
        console.error('Failed to load tapps:', error);
      } finally {
        setTappsLoading(false);
      }
    };
    loadTapps();
  }, []);

  // 获取最近使用的 Tapp（按 last_run_at 排序，取前3个）
  const recentTapps = [...tapps]
    .filter(t => t.last_run_at)
    .sort((a, b) => new Date(b.last_run_at!).getTime() - new Date(a.last_run_at!).getTime())
    .slice(0, 3);

  // 处理修改密码
  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordError('');

    const formData = new FormData(e.currentTarget);
    const oldPassword = formData.get('old-password') as string;
    const newPassword = formData.get('new-password') as string;
    const confirmPassword = formData.get('confirm-password') as string;

    if (newPassword.length < 8) {
      setPasswordError(t.userModal.newPasswordMinLength);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t.userModal.passwordMismatch);
      return;
    }

    if (oldPassword === newPassword) {
      setPasswordError(t.userModal.passwordSameAsOld);
      return;
    }

    setPasswordSubmitting(true);

    try {
      const csrfToken = await getCSRFToken(true);
      if (!csrfToken) {
        setPasswordError(t.userModal.cannotGetCsrf);
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
        alert(t.userModal.passwordChanged);
        e.currentTarget.reset();
        setShowChangePassword(false);
      } else {
        setPasswordError(result.message || result.error || t.common.error);
      }
    } catch (error) {
      setPasswordError(t.userModal.networkError);
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleTappClick = (tappId: string) => {
    onClose();
    navigate(`/tapp/run/${tappId}`);
  };

  const handleViewAllTapps = () => {
    onClose();
    navigate('/tapp');
  };

  return (
    <div className={`user-modal ${isClosing ? 'closing' : ''}`}>
      {/* 浮动关闭按钮 */}
      <button
        onClick={onClose}
        className="user-modal-close-float"
        aria-label={t.common.close}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* 上部区域：用户信息（约60%） */}
      <div className="user-modal-hero">
        {/* 装饰背景 */}
        <div className="user-modal-hero-bg" />
        
        {/* 头像 - 居中 */}
        <div className="user-modal-avatar-wrapper">
          <img
            src={userInfo.avatar}
            alt={userInfo.name}
            className="user-modal-avatar-lg"
            onError={(e) => {
              e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userInfo.name)}&size=128&background=6366f1&color=fff`;
            }}
          />
          {/* 在线状态指示器 */}
          <div className="user-modal-online-dot" />
        </div>

        {/* 用户名和角色 */}
        <div className="user-modal-identity">
          <h3 className="user-modal-username">{userInfo.name}</h3>
          <div className="user-modal-badges">
            {/* 角色徽章 */}
            <span className={`user-modal-badge ${user.is_admin ? 'badge-admin' : 'badge-user'}`}>
              {user.is_admin ? '👑 Admin' : '👤 User'}
            </span>
            {/* 账户类型徽章 */}
            <span className={`user-modal-badge ${user.auth_provider === 'github' ? 'badge-github' : 'badge-local'}`}>
              {user.auth_provider === 'github' ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd"/>
                  </svg>
                  GitHub
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Local
                </>
              )}
            </span>
            {/* GitHub 绑定状态 */}
            {user.auth_provider === 'local' && user.linked_github_id && (
              <span className="user-modal-badge badge-linked">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
                {t.userModal.githubLinked}
              </span>
            )}
          </div>
        </div>

        {/* 简介 */}
        {userInfo.bio && userInfo.bio !== t.userModal.defaultBio && (
          <p className="user-modal-bio">{userInfo.bio}</p>
        )}

        {/* 操作按钮组 */}
        <div className="user-modal-actions">
          {/* 绑定 GitHub */}
          {user.auth_provider === 'local' && !user.linked_github_id && (
            <a
              href={`${API_URL}/api/auth/github/link`}
              className="user-modal-action-btn action-github"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd"/>
              </svg>
              {t.userModal.bindGithub}
            </a>
          )}

          {/* 修改密码 */}
          {user.auth_provider === 'local' && !user.linked_github_id && !showChangePassword && (
            <button
              onClick={() => setShowChangePassword(true)}
              className="user-modal-action-btn action-password"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {t.userModal.changePassword}
            </button>
          )}

          {/* 退出登录 */}
          <button onClick={onLogout} className="user-modal-action-btn action-logout">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {t.userModal.logout}
          </button>
        </div>

        {/* 修改密码表单 */}
        {showChangePassword && (
          <div className="user-modal-password-form">
            <form onSubmit={handleChangePassword} className="space-y-3">
              <input
                type="password"
                name="old-password"
                required
                className="user-modal-input"
                placeholder={t.userModal.currentPassword}
              />
              <input
                type="password"
                name="new-password"
                required
                minLength={8}
                className="user-modal-input"
                placeholder={t.userModal.newPassword}
              />
              <input
                type="password"
                name="confirm-password"
                required
                minLength={8}
                className="user-modal-input"
                placeholder={t.userModal.confirmNewPassword}
              />
              {passwordError && (
                <p className="text-red-500 text-xs text-center">{passwordError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={passwordSubmitting}
                  className="flex-1 user-modal-action-btn action-confirm"
                >
                  {passwordSubmitting ? t.userModal.changing : t.userModal.confirmChange}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowChangePassword(false); setPasswordError(''); }}
                  className="user-modal-action-btn action-cancel"
                >
                  {t.common.cancel}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* 下部区域：Tapp 信息（约40%） */}
      <div className="user-modal-tapps">
        <div className="user-modal-tapps-header">
          <div className="user-modal-tapps-title">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <span>Tapp</span>
          </div>
          {/* 已安装数 + 查看全部合并 */}
          <button onClick={handleViewAllTapps} className="user-modal-tapps-count-btn" title={t.userModal.viewAllTapps || 'View all Tapps'}>
            {tappsLoading ? (
              <span className="user-modal-tapps-loading" />
            ) : (
              <>
                <span className="user-modal-tapps-number">{tapps.length}</span>
                <span className="user-modal-tapps-label">{t.userModal.installedApps || 'installed'}</span>
                <svg className="user-modal-tapps-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>

        {/* 最近使用的 Tapp */}
        {!tappsLoading && recentTapps.length > 0 && (
          <div className="user-modal-recent-tapps">
            <p className="user-modal-recent-label">{t.userModal.recentlyUsed || 'Recently used'}</p>
            <div className="user-modal-recent-list">
              {recentTapps.map((tapp) => (
                <button
                  key={tapp.id}
                  onClick={() => handleTappClick(tapp.id)}
                  className="user-modal-tapp-item"
                >
                  <div className="user-modal-tapp-icon">
                    {tapp.icon ? (
                      <span>{tapp.icon}</span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    )}
                  </div>
                  <span className="user-modal-tapp-name">{tapp.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserModal;
