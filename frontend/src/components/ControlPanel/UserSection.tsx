import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { API_URL } from '../../config';
import { clearPlaylistCache } from '../../utils/musicPlayer';
import { invalidateAuthCache, invalidateUserInfoCache, clearAllUserCache } from '../../utils/userInfoCache';
import LoginForm from '../LoginForm';
import { UserModal } from './UserModal';

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

interface UserSectionProps {
  onClosePanel: () => void;
}

/**
 * 用户区域组件
 * 包含顶部用户信息按钮和用户弹窗逻辑
 */
export const UserSection: React.FC<UserSectionProps> = ({ onClosePanel }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [isUserModalClosing, setIsUserModalClosing] = useState(false);

  // 用户弹窗滚动锁定
  useEffect(() => {
    if (showUserModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [showUserModal]);

  // 获取平台用户信息
  const fetchUserInfo = useCallback(async () => {
    try {
      const profileResponse = await fetch(`${API_URL}/api/profile/user-info`);
      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        if (profileData.success && profileData.user_info) {
          setUserInfo({
            name: profileData.user_info.name || '未知用户',
            avatar: profileData.user_info.avatar || '',
            bio: profileData.user_info.bio || '这家伙很懒，没有介绍呢',
            platform: profileData.user_info.platform || 'Unknown'
          });
        }
      }
    } catch (error) {
      // 静默处理错误
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include',
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setIsAuthenticated(true);

        // 获取平台用户信息
        fetchUserInfo();
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    }
  }, [fetchUserInfo]);

  // 初始化
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 监听登录成功事件
  const checkAuthRef = useRef(checkAuth);
  checkAuthRef.current = checkAuth;
  
  useEffect(() => {
    const handleLoginSuccess = () => {
      handleUserModalClose();
      // 登录成功后清除缓存，强制刷新用户信息
      invalidateAuthCache();
      invalidateUserInfoCache();
      checkAuthRef.current();
    };

    window.addEventListener('auth-login-success', handleLoginSuccess);
    return () => {
      window.removeEventListener('auth-login-success', handleLoginSuccess);
    };
  }, []);

  // 监听打开用户弹窗事件（从其他组件触发）
  useEffect(() => {
    const handleOpenUserModal = () => {
      setIsUserModalClosing(false);
      setShowUserModal(true);
    };

    window.addEventListener('open-user-modal', handleOpenUserModal);
    return () => {
      window.removeEventListener('open-user-modal', handleOpenUserModal);
    };
  }, []);

  // 处理用户信息区域点击
  const handleUserInfoClick = () => {
    setIsUserModalClosing(false);
    setShowUserModal(true);
  };

  // 处理用户弹窗关闭
  const handleUserModalClose = () => {
    setIsUserModalClosing(true);
    setTimeout(() => {
      setShowUserModal(false);
      setIsUserModalClosing(false);
    }, 300);
  };

  // 处理退出登录
  const handleLogout = useCallback(async () => {
    onClosePanel();
    
    // 触发认证状态变化事件
    window.dispatchEvent(new CustomEvent('auth-state-changed', { 
      detail: { 
        isAuthenticated: false,
        isAdmin: false
      }
    }));
    
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      // 静默处理退出错误
    }
    
    // 清除用户信息缓存
    clearAllUserCache();
    
    // 彻底清理所有本地状态和存储
    localStorage.clear();
    sessionStorage.clear();
    
    // 清空音乐播放器缓存
    clearPlaylistCache();
    
    // 手动删除所有Cookie
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict`;
      document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    });
    
    window.location.href = '/login';
  }, [onClosePanel]);

  return (
    <>
      {/* 头部 - 用户信息按钮 */}
      <button
        onClick={handleUserInfoClick}
        className="user-info-button flex items-center gap-3"
      >
        {isAuthenticated && userInfo ? (
          <>
            <img
              src={userInfo.avatar}
              alt={userInfo.name}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              onError={(e) => {
                e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userInfo.name)}`;
              }}
            />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                {userInfo.name}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {userInfo.bio.length > 30 ? `${userInfo.bio.substring(0, 30)}...` : userInfo.bio}
              </p>
            </div>
          </>
        ) : (
          <>
            <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">请先登录</span>
          </>
        )}
      </button>

      {/* 用户信息/登录弹窗 - 使用 Portal 渲染到 body，避免 transform 影响 fixed 定位 */}
      {showUserModal && createPortal(
        <>
          <div className={`user-modal-overlay ${isUserModalClosing ? 'closing' : ''}`} onClick={handleUserModalClose} />
          {isAuthenticated && user && userInfo ? (
            <UserModal
              user={user}
              userInfo={userInfo}
              isClosing={isUserModalClosing}
              onClose={handleUserModalClose}
              onLogout={handleLogout}
            />
          ) : (
            <div className={`user-modal-login-only ${isUserModalClosing ? 'closing' : ''}`}>
              <button
                onClick={handleUserModalClose}
                className="login-close-btn"
                aria-label="关闭"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <LoginForm />
            </div>
          )}
        </>,
        document.body
      )}
    </>
  );
};

// 导出用户和用户信息类型供外部使用
export type { User, UserInfo };

export default UserSection;
