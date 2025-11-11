import React, { useState, useEffect } from 'react';
import './GlobalControlPanel.css';

const GlobalControlPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // 检查当前主题
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleTheme = () => {
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
  };

  return (
    <React.Fragment>
      <div className="global-control-trigger">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="control-trigger-btn"
          aria-label="打开控制面板"
          title="控制面板"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
        </button>
      </div>

      {isOpen && (
        <React.Fragment>
          <div
            className="control-panel-overlay"
            onClick={() => setIsOpen(false)}
          />

          <div className="control-panel">
            <div className="control-panel-header">
              <h3 className="control-panel-title">控制中心</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="control-close-btn"
                aria-label="关闭"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="control-panel-content">
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
            </div>
          </div>
        </React.Fragment>
      )}
    </React.Fragment>
  );
};

export default GlobalControlPanel;
