import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import './GlobalControlPanel.css';
import {
  getGreeting,
  getWeatherInfo,
  getRandomQuote,
  getThemeInfo,
  WeatherData,
  QuoteData,
  GreetingData
} from '../utils/smartWidgets';

interface User {
  username: string;
  is_admin: boolean;
  auth_provider: string;
  display_name?: string;
  linked_github_id?: string;
}

interface DynamicContent {
  type: 'greeting' | 'weather' | 'quote' | 'theme';
  icon: string;
  text: string;
  subtext?: string;
}

const GlobalControlPanel: React.FC = () => {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDynamicContent, setShowDynamicContent] = useState(true);
  const [showPanelContent, setShowPanelContent] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // 动态内容状态
  const [dynamicContents, setDynamicContents] = useState<DynamicContent[]>([]);
  const [currentContentIndex, setCurrentContentIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);
  const [expandedCardIndex, setExpandedCardIndex] = useState(0); // 0=天气, 1=名言

  // DOM 引用
  const triggerRef = useRef<HTMLDivElement>(null);
  const expandedContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 检查当前主题
    setIsDark(document.documentElement.classList.contains('dark'));

    // 检查登录状态
    checkAuth();

    // 加载动态内容
    loadDynamicContents();
  }, []);

  // 加载动态内容
  const loadDynamicContents = useCallback(async () => {
    const contents: DynamicContent[] = [];

    // 1. 问候语（始终显示）
    const greeting = getGreeting(user?.username);
    contents.push({
      type: 'greeting',
      icon: greeting.icon,
      text: greeting.text,
      subtext: greeting.time
    });

    // 2. 天气信息
    try {
      const weather = await getWeatherInfo();
      if (weather) {
        setWeatherData(weather);
        contents.push({
          type: 'weather',
          icon: weather.icon,
          text: `${weather.city} ${weather.weather}`,
          subtext: weather.temperature
        });
      }
    } catch (error) {
      console.warn('Failed to load weather', error);
    }

    // 3. 一言警句
    try {
      const quote = await getRandomQuote();
      if (quote) {
        setQuoteData(quote);
        contents.push({
          type: 'quote',
          icon: '💭',
          text: quote.text,
          subtext: quote.author
        });
      }
    } catch (error) {
      console.warn('Failed to load quote', error);
    }

    // 4. 主题状态
    const theme = getThemeInfo();
    contents.push({
      type: 'theme',
      icon: theme.icon,
      text: theme.text,
      subtext: '点击切换'
    });

    setDynamicContents(contents);
  }, [user?.username]);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    setIsAuthenticated(!!token);

    if (token) {
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const userData = await response.json();
          setUser(userData);

          // 获取头像
          let avatar = `https://ui-avatars.com/api/?name=${userData.username}`;
          try {
            const profileResponse = await fetch(`${API_URL}/api/profile/user-info`);
            if (profileResponse.ok) {
              const profileData = await profileResponse.json();
              if (profileData.success && profileData.user_info?.avatar) {
                avatar = profileData.user_info.avatar;
              }
            }
          } catch {
            // 使用默认头像
          }
          setAvatarUrl(avatar);
        }
      } catch {
        setIsAuthenticated(false);
      }
    }
  }, []);

  // 当用户信息更新时，重新加载动态内容
  useEffect(() => {
    if (user) {
      loadDynamicContents();
    }
  }, [user, loadDynamicContents]);

  // 动态内容轮播（带淡入淡出效果）
  useEffect(() => {
    if (dynamicContents.length === 0 || isExpanded || isHovering) return;

    const interval = setInterval(() => {
      // 先淡出
      setIsTransitioning(true);

      // 300ms 后切换内容
      setTimeout(() => {
        setCurrentContentIndex((prev) => (prev + 1) % dynamicContents.length);
        // 再淡入
        setTimeout(() => {
          setIsTransitioning(false);
        }, 50);
      }, 300);
    }, 8000); // 每8秒切换

    return () => clearInterval(interval);
  }, [dynamicContents.length, isExpanded, isHovering]);

  // 监听主题变化，更新动态内容
  useEffect(() => {
    const handleThemeChange = () => {
      const newIsDark = document.documentElement.classList.contains('dark');
      setIsDark(newIsDark);
      loadDynamicContents();
    };

    // 使用 MutationObserver 监听主题变化
    const observer = new MutationObserver(handleThemeChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, [loadDynamicContents]);

  // 展开后的卡片轮播
  useEffect(() => {
    if (!isExpanded || !weatherData || !quoteData) return;

    const interval = setInterval(() => {
      setExpandedCardIndex(prev => (prev + 1) % 2);
    }, 6000); // 每6秒切换

    return () => clearInterval(interval);
  }, [isExpanded, weatherData, quoteData]);

  // 动态计算展开面板的高度
  useEffect(() => {
    if (!triggerRef.current) return;
    
    const triggerEl = triggerRef.current;
    
    // 收缩时恢复默认高度
    if (!isExpanded) {
      triggerEl.style.height = '3rem';
      return;
    }
    
    // 展开时计算高度
    if (expandedContentRef.current) {
      const contentEl = expandedContentRef.current;
      const triggerStyle = window.getComputedStyle(triggerEl);
      
      // 创建临时测量容器
      const measureContainer = document.createElement('div');
      measureContainer.style.cssText = `
        position: absolute;
        visibility: hidden;
        pointer-events: none;
        width: 420px;
        padding: ${triggerStyle.paddingTop} ${triggerStyle.paddingRight} ${triggerStyle.paddingBottom} ${triggerStyle.paddingLeft};
        top: -9999px;
        left: -9999px;
        box-sizing: border-box;
      `;
      
      // 克隆内容元素
      const clonedContent = contentEl.cloneNode(true) as HTMLElement;
      clonedContent.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
        width: 100%;
        opacity: 1;
        transform: none;
        visibility: visible;
      `;
      
      measureContainer.appendChild(clonedContent);
      document.body.appendChild(measureContainer);
      
      // 测量并应用高度
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const measuredHeight = measureContainer.offsetHeight;
          const compensatedHeight = Math.ceil(measuredHeight * 1.06);
          
          document.body.removeChild(measureContainer);
          triggerEl.style.height = `${compensatedHeight}px`;
        });
      });
    }
  }, [isExpanded, isAuthenticated]);

  const toggleTheme = useCallback(() => {
    const html = document.documentElement;
    const newIsDark = !isDark;

    if (newIsDark) {
      html.classList.add('dark');
      html.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }

    setIsDark(newIsDark);

    // 更新 meta theme-color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', newIsDark ? '#1a1a1a' : '#fef3c7');
    }
  }, [isDark]);

  const handleTogglePanel = useCallback(() => {
    if (isExpanded) {
      // 收缩：面板内容立即淡出，容器开始收缩，动态内容在中途淡入
      setShowPanelContent(false);
      setIsExpanded(false);
      setTimeout(() => {
        setShowDynamicContent(true);
      }, 400); // 容器收缩到一半时显示（0.7s 动画的中点）
    } else {
      // 展开：动态内容立即淡出，容器开始展开，面板内容在中途淡入
      setShowDynamicContent(false);
      setIsExpanded(true);
      setTimeout(() => {
        setShowPanelContent(true);
      }, 400); // 容器展开到一半时显示（0.7s 动画的中点）
    }
  }, [isExpanded]);

  const handleClosePanel = useCallback(() => {
    handleTogglePanel();
  }, [handleTogglePanel]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('auth_token');
    setIsAuthenticated(false);
    setUser(null);
    handleClosePanel();
    navigate('/login');
  }, [navigate, handleClosePanel]);

  // 获取当前显示的动态内容
  const currentContent = dynamicContents[currentContentIndex];

  return (
    <React.Fragment>
      {/* 顶部控制栏 - 智能岛 */}
      <div className="global-control-bar">
        <div className="control-bar-content">
          <div
            ref={triggerRef}
            className={`control-bar-trigger ${isExpanded ? 'expanded' : ''}`}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            {/* 动态轮播内容 - 通过 JS 控制显示/隐藏 */}
            {currentContent && (
              <div
                className={`dynamic-content-wrapper ${!showDynamicContent || isTransitioning ? 'hidden' : ''}`}
                onClick={handleTogglePanel}
              >
                <span className="dynamic-icon">
                  {currentContent.icon}
                </span>
                <div className="dynamic-text">
                  <span className="dynamic-text-main">{currentContent.text}</span>
                  {/* 只显示天气和主题的 subtext，问候语和一言不显示 */}
                  {currentContent.subtext && (currentContent.type === 'weather' || currentContent.type === 'theme') && (
                    <span className="dynamic-text-sub">{currentContent.subtext}</span>
                  )}
                </div>
                <svg className="dynamic-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            )}

            {/* 展开的控制面板内容 - 通过 JS 控制显示/隐藏 */}
            <div ref={expandedContentRef} className={`expanded-panel-content ${showPanelContent ? 'visible' : ''}`}>
                {/* 头部 */}
                <div className="control-panel-header">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">控制中心</h3>
                  <button
                    onClick={handleClosePanel}
                    className="control-close-btn"
                    aria-label="关闭"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* 动态信息卡片 - 切换显示 */}
                <div className="info-card-wrapper">
                  {/* 天气卡片 */}
                  {weatherData && expandedCardIndex === 0 && (
                    <div className="info-card weather-card animated">
                      <div className="info-card-header">
                        <span className="info-card-icon">{weatherData.icon}</span>
                        <span className="info-card-title">天气</span>
                      </div>
                      <div className="weather-details">
                        <div className="weather-primary">
                          <div className="weather-temp-large">{weatherData.temperature}</div>
                          <div className="weather-location">{weatherData.city}</div>
                        </div>
                        <div className="weather-secondary">
                          <div className="weather-status">{weatherData.weather}</div>
                          {(weatherData.feelsLike !== undefined || weatherData.humidity !== undefined || weatherData.windSpeed !== undefined) && (
                            <div className="weather-extra-info">
                              {weatherData.feelsLike !== undefined && (
                                <span>体感 {weatherData.feelsLike}°C</span>
                              )}
                              {weatherData.humidity !== undefined && (
                                <span>💧 {weatherData.humidity}%</span>
                              )}
                              {weatherData.windSpeed !== undefined && (
                                <span>🍃 {Math.round(weatherData.windSpeed)} km/h</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 名言卡片 */}
                  {quoteData && expandedCardIndex === 1 && (
                    <div className="info-card quote-card animated">
                      <div className="info-card-header">
                        <span className="info-card-icon">💭</span>
                        <span className="info-card-title">一言</span>
                      </div>
                      <div className="quote-details">
                        <div className="quote-text-main">{quoteData.text}</div>
                        {quoteData.author && (
                          <div className="quote-author-main">— {quoteData.author}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 切换按钮 */}
                  {weatherData && quoteData && (
                    <div className="card-nav-dots">
                      <button 
                        className={`nav-dot ${expandedCardIndex === 0 ? 'active' : ''}`}
                        onClick={() => setExpandedCardIndex(0)}
                        aria-label="显示天气"
                      />
                      <button 
                        className={`nav-dot ${expandedCardIndex === 1 ? 'active' : ''}`}
                        onClick={() => setExpandedCardIndex(1)}
                        aria-label="显示名言"
                      />
                    </div>
                  )}
                </div>

                {/* 主题切换 */}
                <div className="control-item">
                  <div className="control-item-info">
                    <div className="control-item-icon">
                      {isDark ? '🌙' : '☀️'}
                    </div>
                    <div>
                      <h4 className="control-item-title">外观模式</h4>
                      <p className="control-item-desc">{isDark ? '深色模式' : '浅色模式'}</p>
                    </div>
                  </div>
                  <button
                    onClick={toggleTheme}
                    className={`control-toggle ${isDark ? 'active' : ''}`}
                    aria-label="切换主题"
                  >
                    <span className="control-toggle-slider"></span>
                  </button>
                </div>

                {/* 账户信息 */}
                {isAuthenticated && user && (
                  <div className="account-info">
                    <div className="account-header">
                      <img
                        src={avatarUrl}
                        className="account-avatar"
                        alt={user.username}
                        onError={(e) => {
                          e.currentTarget.src = `https://ui-avatars.com/api/?name=${user.username}`;
                        }}
                      />
                      <div className="account-details">
                        <h4 className="account-name">{user.username}</h4>
                        <p className="account-role">
                          {user.is_admin ? '👑 管理员' : '👤 普通用户'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleLogout}
                      className="account-action-btn account-action-danger"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      退出登录
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>

      {/* 遮罩层 - 仅展开时显示 */}
      {isExpanded && (
        <div
          className="control-panel-overlay"
          onClick={handleClosePanel}
        />
      )}
    </React.Fragment>
  );
};

export default GlobalControlPanel;
