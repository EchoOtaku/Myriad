import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '@/config';
import PlatformIcon from './PlatformIcon';
import Toast from './Toast';
import { FaSearch, FaTimes, FaStar } from 'react-icons/fa';
import { fetchJson } from '../utils/apiHelper';
import { useDebounce } from '../hooks/useDebounce';
import './ConfigForm.css';

// 注意：懒加载配置组件已创建但暂未使用，以保持稳定性
// 可在后续迭代中逐步替换现有实现
// const PlatformConfigSection = lazy(() => import('./config/PlatformConfigSection'));
// const AiConfigSection = lazy(() => import('./config/AiConfigSection'));
// const GenericConfigSection = lazy(() => import('./config/GenericConfigSection'));

interface ConfigField {
  key: string;
  label: string;
  field_type: string;
  value: string;
  placeholder: string;
  required: boolean;
}

interface PlatformConfig {
  name: string;
  enabled: boolean;
  has_token: boolean;
  config_fields: ConfigField[];
  description: string;
  icon: string;
}

interface AiConfig {
  provider: string;
  model: string;
  api_key: string;
  enabled: boolean;
  config_fields: ConfigField[];
}

interface ReportConfig {
  topic_style: string;
  config_fields: ConfigField[];
}

interface PersonaConfig {
  enabled: boolean;
  provider: string;
  config_fields: ConfigField[];
}

interface UiConfig {
  wallpaper_url: string;
  wallpaper_blur: number;
  theme: string;
  primary_color: string;
  secondary_color: string;
  config_fields: ConfigField[];
}

interface Config {
  platforms: PlatformConfig[];
  ai_config: AiConfig;
  report_config: ReportConfig;
  persona_config: PersonaConfig;
  ui_config: UiConfig;
}

interface QuickAccessItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  section: string;
  subsection?: string;
}

// 优化：提取为独立的 memo 组件避免不必要的重渲染
interface QuickAccessCardProps {
  item: QuickAccessItem;
  isActive: boolean;
  isFavorite: boolean;
  onCardClick: (section: string) => void;
  onToggleFavorite: (id: string) => void;
}

const QuickAccessCard = React.memo<QuickAccessCardProps>(({
  item,
  isActive,
  isFavorite,
  onCardClick,
  onToggleFavorite
}) => {
  const handleCardClick = React.useCallback(() => {
    onCardClick(item.section);
  }, [onCardClick, item.section]);

  const handleFavoriteClick = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite(item.id);
  }, [onToggleFavorite, item.id]);

  return (
    <div
      onClick={handleCardClick}
      className={`quick-access-card ${isActive ? 'active' : ''}`}
    >
      <span className="card-icon">{item.icon}</span>
      <span className="card-label">{item.label}</span>
      <button
        onClick={handleFavoriteClick}
        className={`favorite-btn ${isFavorite ? 'active' : ''}`}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <FaStar />
      </button>
    </div>
  );
});

QuickAccessCard.displayName = 'QuickAccessCard';

const ModernConfigForm: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [activeSection, setActiveSection] = useState<string>('platforms');
  const [platformModalOpen, setPlatformModalOpen] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['platforms', 'ai'];
    const saved = localStorage.getItem('config_favorites');
    return saved ? JSON.parse(saved) : ['platforms', 'ai'];
  });

  // 使用防抖优化搜索性能 - 避免频繁搜索
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // 快速访问项（使用 useMemo 避免每次渲染重新创建数组）
  const quickAccessItems: QuickAccessItem[] = useMemo(() => [
    { id: 'platforms', label: '数据平台', icon: '🌐', section: 'platforms' },
    { id: 'data', label: '数据管理', icon: '💾', section: 'data' },
    { id: 'ai', label: 'AI配置', icon: '🤖', section: 'ai' },
    { id: 'report', label: '报告生成', icon: '📊', section: 'report' },
    { id: 'persona', label: '虚拟人设', icon: '🎭', section: 'persona' },
    { id: 'ui', label: 'UI界面', icon: '🎨', section: 'ui' },
    { id: 'music', label: '音乐播放器', icon: '🎵', section: 'music' },
    { id: 'oauth', label: 'OAuth登录', icon: '🔐', section: 'oauth' },
    { id: 'pet', label: '宠物吉祥物', icon: '🐱', section: 'pet' },
  ], []);

  // 搜索功能
  const searchableContent = useMemo(() => {
    if (!config) return [];
    
    const items: Array<{ type: string; section: string; title: string; description: string; keywords: string[] }> = [];
    
    // 平台配置
    config.platforms.forEach(platform => {
      items.push({
        type: 'platform',
        section: 'platforms',
        title: platform.name,
        description: platform.description,
        keywords: [platform.name.toLowerCase(), '平台', '数据源', 'token', 'api']
      });
    });
    
    // AI配置
    items.push({
      type: 'section',
      section: 'ai',
      title: 'AI配置',
      description: 'AI模型和API密钥配置',
      keywords: ['ai', 'gemini', 'openai', 'api', '模型', '智能']
    });
    
    // 报告配置
    items.push({
      type: 'section',
      section: 'report',
      title: '报告生成配置',
      description: '设置报告话题风格和生成选项',
      keywords: ['报告', 'report', '话题', '风格', '生成']
    });
    
    // 虚拟人设
    items.push({
      type: 'section',
      section: 'persona',
      title: '虚拟人设配置',
      description: '配置虚拟人设图片生成服务',
      keywords: ['虚拟', '人设', 'persona', '图片', '生成', 'ai']
    });
    
    // UI配置
    items.push({
      type: 'section',
      section: 'ui',
      title: 'UI界面配置',
      description: '自定义背景、主题等界面样式',
      keywords: ['ui', '界面', '主题', '背景', '样式', 'theme']
    });
    
    // OAuth配置
    items.push({
      type: 'section',
      section: 'oauth',
      title: 'GitHub OAuth配置',
      description: '配置GitHub OAuth应用以启用社交登录',
      keywords: ['oauth', 'github', '登录', 'auth', '认证']
    });
    
    // 音乐播放器
    items.push({
      type: 'section',
      section: 'music',
      title: '音乐播放器',
      description: '配置歌单播放',
      keywords: ['音乐', 'music', '歌单', '播放器', '网易云', 'qq音乐']
    });

    // 宠物配置
    items.push({
      type: 'section',
      section: 'pet',
      title: '宠物吉祥物',
      description: '可爱的行走角色',
      keywords: ['宠物', 'pet', '吉祥物', '角色']
    });

    return items;
  }, [config]);

  // 使用防抖后的搜索查询优化性能
  const filteredContent = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return searchableContent;

    const query = debouncedSearchQuery.toLowerCase();
    return searchableContent.filter(item =>
      item.title.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.keywords.some(k => k.includes(query))
    );
  }, [debouncedSearchQuery, searchableContent]);

  // 切换收藏
  const toggleFavorite = React.useCallback((section: string) => {
    setFavorites(prev => {
      const updated = prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section];
      if (typeof window !== 'undefined') {
        localStorage.setItem('config_favorites', JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  // 处理节切换
  const handleSectionChange = React.useCallback((section: string) => {
    // 如果是数据管理，直接跳转到专门页面
    if (section === 'data') {
      navigate('/data-management');
      return;
    }
    setActiveSection(section);
    setSearchQuery('');
  }, [navigate]);

  const handleSave = React.useCallback(async () => {
    if (!config) {
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: false, message: '配置为空，无法保存' },
        })
      );
      return;
    }

    setMessage('保存中...');

    try {
      const result = await fetchJson(
        `${API_URL}/api/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        },
        '保存配置失败'
      );
      
      setMessage('✓ 配置已保存！正在重启后端...');
      notifyDirtyState(false);
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: true, message: result.message || '配置已保存' },
        })
      );

      try {
        await fetchJson(
          `${API_URL}/api/system/reload-config`,
          { method: 'POST' },
          '重启后端失败'
        );

        setMessage('✓ 配置已保存！后端正在重启...');
        
        // 刷新网站元数据（如果配置了站点标题、描述或图标）
        setTimeout(async () => {
          try {
            const { refreshSiteMetadata } = await import('../utils/siteMetadata');
            await refreshSiteMetadata();
            console.log('[配置] 网站元数据已刷新');
          } catch (error) {
            console.warn('[配置] 刷新元数据失败:', error);
          }
        }, 3000); // 等待后端重启完成
        
        setTimeout(() => {
          setMessage('✓ 后端重启完成，配置已生效');
          setTimeout(() => setMessage(''), 3000);
        }, 5000);
      } catch (restartError) {
        setMessage('✓ 配置已保存！请手动重启后端生效。');
        setTimeout(() => setMessage(''), 5000);
      }
    } catch (error) {
      const errorMsg = '✗ 保存配置失败：' + (error instanceof Error ? error.message : '网络错误');
      setMessage(errorMsg);
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: false, message: errorMsg },
        })
      );
    }
  }, [config]);

  const handleReset = React.useCallback(async () => {
    setMessage('正在重置配置...');
    
    try {
      const data = await fetchJson(`${API_URL}/api/config`, {}, '加载配置失败');
      
      const clearedData = {
        ...data,
        platforms: data.platforms.map((platform: any) => ({
          ...platform,
          enabled: false,
          has_token: false,
          config_fields: platform.config_fields.map((field: any) => ({
            ...field,
            value: '',
          })),
        })),
        ai_config: {
          ...data.ai_config,
          enabled: false,
          api_key: '',
          config_fields: data.ai_config.config_fields.map((field: any) => ({
            ...field,
            value: field.key === 'model' ? 'gemini-pro' : '',
          })),
        },
        report_config: {
          ...data.report_config,
          config_fields: data.report_config.config_fields.map((field: any) => ({
            ...field,
            value: field.key === 'topic_style' ? 'balanced' : field.value,
          })),
        },
        persona_config: {
          ...data.persona_config,
          config_fields: data.persona_config.config_fields.map((field: any) => {
            let defaultValue = '';
            if (field.key === 'persona_image_enabled') defaultValue = 'true';
            else if (field.key === 'persona_image_provider') defaultValue = 'pollinations';
            else if (field.key === 'persona_image_model') defaultValue = 'flux-anime';
            else if (field.key === 'persona_image_width') defaultValue = '512';
            else if (field.key === 'persona_image_height') defaultValue = '768';
            return { ...field, value: defaultValue };
          }),
        },
        ui_config: {
          ...data.ui_config,
          config_fields: data.ui_config.config_fields.map((field: any) => {
            let defaultValue = '';
            if (field.key === 'wallpaper_url') defaultValue = 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809';
            else if (field.key === 'wallpaper_blur') defaultValue = '3';
            else if (field.key === 'pet_enabled') defaultValue = 'true';
            else if (field.key === 'pet_image_url') defaultValue = 'https://api.fuukei.org/myriad/frontend/public/furina.png';
            return { ...field, value: defaultValue };
          }),
        },
      };
      
      setConfig(clearedData);
      notifyDirtyState(false);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      setMessage('正在保存默认配置...');
      
      const saveResult = await fetchJson(
        `${API_URL}/api/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clearedData),
        },
        '保存配置失败'
      );

      setMessage('✓ 配置已重置并保存！');
      setTimeout(() => setMessage(''), 5000);
      
      window.dispatchEvent(
        new CustomEvent('config-reset-result', {
          detail: { success: true, message: saveResult.message || '配置已重置为默认值并保存' },
        })
      );
    } catch (error) {
      const errorMsg = '重置配置失败：' + (error instanceof Error ? error.message : '未知错误');
      setMessage(errorMsg);
      window.dispatchEvent(
        new CustomEvent('config-reset-result', {
          detail: { success: false, message: errorMsg },
        })
      );
    }
  }, []);

  const notifyDirtyState = React.useCallback((dirty: boolean) => {
    window.dispatchEvent(
      new CustomEvent('config-dirty-state', {
        detail: { dirty },
      })
    );
  }, []);

  const loadConfig = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson(`${API_URL}/api/config`, {}, '加载配置失败');
      setConfig(data);
      notifyDirtyState(false);

      const event = new CustomEvent('config-loaded', { detail: data });
      window.dispatchEvent(event);
    } catch (error) {
      setMessage('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [notifyDirtyState]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const handleSaveEvent = () => handleSave();
    const handleResetEvent = () => handleReset();

    window.addEventListener('request-config-save', handleSaveEvent);
    window.addEventListener('config-reset', handleResetEvent);

    return () => {
      window.removeEventListener('request-config-save', handleSaveEvent);
      window.removeEventListener('config-reset', handleResetEvent);
    };
  }, [handleSave, handleReset]);

  const handleTest = React.useCallback(async (platformName: string) => {
    const platform = config?.platforms.find(p => p.name === platformName);
    if (!platform) return;

    setTesting(platformName);
    setMessage('');

    try {
      const configObj: any = {};
      platform.config_fields.forEach(field => {
        configObj[field.key] = field.value;
      });

      const result = await fetchJson(
        `${API_URL}/api/config/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: platformName,
            config: configObj,
          }),
        },
        '测试连接失败'
      );

      setMessage(result.message);
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      setMessage('✗ 连接测试失败');
    } finally {
      setTesting(null);
    }
  }, [config]);

  const updateConfigField = React.useCallback((
    section: 'ai' | 'report' | 'persona' | 'ui',
    fieldKey: string,
    value: string,
    providerFieldKey?: string
  ) => {
    if (!config) return;

    const sectionKey = `${section}_config` as 'ai_config' | 'report_config' | 'persona_config' | 'ui_config';
    const sectionConfig = config[sectionKey];
    const newFields = [...sectionConfig.config_fields];
    const field = newFields.find(f => f.key === fieldKey);

    if (field) {
      field.value = value;

      if (providerFieldKey && fieldKey === providerFieldKey) {
        setConfig({
          ...config,
          [sectionKey]: {
            ...sectionConfig,
            provider: value,
            config_fields: newFields
          }
        });
      } else {
        setConfig({
          ...config,
          [sectionKey]: { ...sectionConfig, config_fields: newFields }
        });
      }
      notifyDirtyState(true);
    }
  }, [config, notifyDirtyState]);

  const updateFieldValue = React.useCallback((platformIndex: number, fieldKey: string, value: string) => {
    if (!config) return;

    const newPlatforms = [...config.platforms];
    const field = newPlatforms[platformIndex].config_fields.find(f => f.key === fieldKey);
    if (field) {
      field.value = value;
      setConfig({ ...config, platforms: newPlatforms });
      notifyDirtyState(true);
    }
  }, [config, notifyDirtyState]);

  const updateAiFieldValue = React.useCallback((fieldKey: string, value: string) => {
    updateConfigField('ai', fieldKey, value, 'provider');
  }, [updateConfigField]);

  const updateReportFieldValue = React.useCallback((fieldKey: string, value: string) => {
    updateConfigField('report', fieldKey, value);
  }, [updateConfigField]);

  const updatePersonaFieldValue = React.useCallback((fieldKey: string, value: string) => {
    updateConfigField('persona', fieldKey, value, 'persona_image_provider');
  }, [updateConfigField]);

  const updateUiFieldValue = React.useCallback((fieldKey: string, value: string) => {
    updateConfigField('ui', fieldKey, value);
  }, [updateConfigField]);

  const togglePlatform = React.useCallback((platformIndex: number) => {
    if (!config) return;

    const newPlatforms = [...config.platforms];
    newPlatforms[platformIndex].enabled = !newPlatforms[platformIndex].enabled;
    setConfig({ ...config, platforms: newPlatforms });
    notifyDirtyState(true);
  }, [config]);

  if (loading) {
    return (
      <div className="modern-config-loading">
        <div className="modern-spinner"></div>
        <p>加载配置中...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="modern-config-error">
        <span className="error-icon">⚠️</span>
        <p>加载配置失败</p>
      </div>
    );
  }

  return (
    <div className="modern-config-container">
      {/* 消息提示 */}
      {message && <Toast message={message} />}

      {/* 配置导航卡片 */}
      <div className="config-nav-card">
        <div className="config-nav-header">
          <div className="nav-header-left">
            <span className="nav-icon">🛠️</span>
            <div>
              <h3 className="nav-title">配置项目</h3>
              <p className="nav-subtitle">选择要配置的项目</p>
            </div>
          </div>
          <div className="nav-header-actions">
            <button
              onClick={handleReset}
              className="nav-action-button reset-button"
              aria-label="重置配置"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>重置配置</span>
            </button>
            <button
              onClick={handleSave}
              className="nav-action-button save-button"
              aria-label="保存配置"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>保存配置</span>
            </button>
          </div>
        </div>
        
        {/* 搜索栏 */}
        <div className="config-search-bar">
          <div className="search-input-wrapper">
            <FaSearch className="search-icon" />
            <input
              type="text"
              placeholder="搜索配置项..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="search-clear"
                aria-label="Clear search"
              >
                <FaTimes />
              </button>
            )}
          </div>
        </div>

        {/* 搜索结果 */}
        {searchQuery ? (
          <div className="search-results">
            <h4 className="search-results-title">
              搜索结果 ({filteredContent.length})
            </h4>
            <div className="search-results-list">
              {filteredContent.length > 0 ? (
                filteredContent.map((item, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      handleSectionChange(item.section);
                    }}
                    className="search-result-item"
                  >
                    <div className="search-result-content">
                      <h4>{item.title}</h4>
                      <p>{item.description}</p>
                    </div>
                    <span className="search-result-arrow">→</span>
                  </button>
                ))
              ) : (
                <div className="search-no-results">
                  <p>未找到匹配的配置项</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="config-nav-content">
            {/* 收藏夹 */}
            {favorites.length > 0 && (
              <div className="nav-section">
                <div className="nav-section-header">
                  <FaStar className="nav-section-icon" />
                  <span className="nav-section-title">收藏夹</span>
                </div>
                <div className="quick-access-grid">
                  {favorites.map(fav => {
                    const item = quickAccessItems.find(i => i.id === fav);
                    return item ? (
                      <QuickAccessCard
                        key={item.id}
                        item={item}
                        isActive={activeSection === item.section}
                        isFavorite={true}
                        onCardClick={handleSectionChange}
                        onToggleFavorite={toggleFavorite}
                      />
                    ) : null;
                  })}
                </div>
              </div>
            )}

            {/* 所有配置 */}
            <div className="nav-section">
              <div className="nav-section-header">
                <span className="nav-section-title">所有配置</span>
              </div>
              <div className="quick-access-grid">
                {quickAccessItems.map(item => (
                  <QuickAccessCard
                    key={item.id}
                    item={item}
                    isActive={activeSection === item.section}
                    isFavorite={favorites.includes(item.id)}
                    onCardClick={handleSectionChange}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 配置内容区域 */}
      {!searchQuery && (
        <div className="config-content">
          {/* 平台配置 */}
          {activeSection === 'platforms' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-platforms">🌐</span>
                  <div>
                    <h2 className="section-title">数据平台配置</h2>
                    <p className="section-description">配置各个数据源平台的访问凭证</p>
                  </div>
                </div>
              </div>

              <div className="platforms-grid">
                {config.platforms.map((platform, index) => (
                  <div key={platform.name} className="platform-card">
                    <div className="platform-header">
                      <div className="platform-info">
                        <div className="platform-icon-wrapper">
                          <PlatformIcon platform={platform.name} className="platform-icon" />
                        </div>
                        <div className="platform-details">
                          <div className="platform-title-row">
                            <h3 className="platform-name">{platform.name}</h3>
                            <span className={`status-badge ${platform.enabled && platform.has_token ? 'configured' : 'unconfigured'}`}>
                              {platform.enabled && platform.has_token ? '✓ 已配置' : '⚠ 未配置'}
                            </span>
                          </div>
                          <p className="platform-desc">{platform.description}</p>
                        </div>
                      </div>
                      <div className="platform-actions">
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={platform.enabled}
                            onChange={() => togglePlatform(index)}
                            aria-label={`Enable ${platform.name}`}
                          />
                          <span className="toggle-slider"></span>
                        </label>

                    <button
                      onClick={() => setPlatformModalOpen(platform.name)}
                      className="config-icon-button"
                      aria-label="配置"
                    >
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI配置 */}
          {activeSection === 'ai' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-ai">🤖</span>
                  <div>
                    <h2 className="section-title">AI配置</h2>
                    <p className="section-description">配置AI模型和API密钥</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="info-card">
                  <p className="info-title">AI 服务配置说明</p>
                  <p className="info-text">
                    支持 Google Gemini 和 OpenAI 兼容格式的 API。<br/>
                    <strong>Google Gemini</strong>: 免费额度，适合个人使用。获取 API Key: <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a><br/>
                    <strong>OpenAI 兼容</strong>: 支持 OpenAI API 和其他兼容服务（如 Azure OpenAI、第三方代理等）
                  </p>
                </div>

                <div className="ai-status-card">
                  <div className="status-info">
                    <p className="status-label">Provider: {config.ai_config.provider}</p>
                    <p className="status-sublabel">Model: {config.ai_config.model}</p>
                  </div>
                  <span className={`status-badge ${config.ai_config.enabled ? 'configured' : 'unconfigured'}`}>
                    {config.ai_config.enabled ? '✓ 已配置' : '✗ 未配置'}
                  </span>
                </div>

                {(() => {
                  const providerField = config.ai_config.config_fields.find(f => f.key === 'provider');
                  if (providerField) {
                    return (
                      <div className="config-field">
                        <label className="field-label">
                          {providerField.label}
                          {providerField.required && <span className="required">*</span>}
                        </label>
                        <div className="provider-selector">
                          <button
                            type="button"
                            onClick={() => updateAiFieldValue('provider', 'gemini')}
                            className={`provider-option ${
                              providerField.value === 'gemini' ? 'active' : ''
                            }`}
                          >
                            <span className="provider-icon">🤖</span>
                            <span className="provider-name">Google Gemini</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => updateAiFieldValue('provider', 'openai')}
                            className={`provider-option ${
                              providerField.value === 'openai' ? 'active' : ''
                            }`}
                          >
                            <span className="provider-icon">✨</span>
                            <span className="provider-name">OpenAI 兼容</span>
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                {(() => {
                  const currentProvider = config.ai_config.config_fields.find(f => f.key === 'provider')?.value || 'gemini';
                  
                  return config.ai_config.config_fields
                    .filter(field => {
                      if (field.key === 'provider') return false;
                      
                      if (currentProvider === 'gemini') {
                        return field.key.startsWith('gemini_');
                      } else if (currentProvider === 'openai') {
                        return field.key.startsWith('openai_');
                      }
                      return false;
                    })
                    .map((field) => (
                      <div key={field.key} className="config-field">
                        <label htmlFor={`ai-${field.key}`} className="field-label">
                          {field.label}
                          {field.required && <span className="required">*</span>}
                        </label>
                        <input
                          id={`ai-${field.key}`}
                          type={field.field_type}
                          value={field.value}
                          onChange={(e) => updateAiFieldValue(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="field-input"
                        />
                      </div>
                    ));
                })()}
              </div>
            </div>
          )}

          {/* 报告配置 */}
          {activeSection === 'report' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-report">📊</span>
                  <div>
                    <h2 className="section-title">报告生成配置</h2>
                    <p className="section-description">设置报告话题风格和生成选项</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                {config.report_config.config_fields.map((field) => (
                  <div key={field.key} className="config-field">
                    <label htmlFor={`report-${field.key}`} className="field-label">
                      {field.label}
                      {field.required && <span className="required">*</span>}
                    </label>
                    {field.field_type === 'select' && field.key === 'topic_style' ? (
                      <>
                        <select
                          id={`report-${field.key}`}
                          value={field.value.startsWith('custom:') ? 'custom' : field.value}
                          onChange={(e) => {
                            if (e.target.value === 'custom') {
                              updateReportFieldValue(field.key, 'custom:');
                            } else {
                              updateReportFieldValue(field.key, e.target.value);
                            }
                          }}
                          className="field-select"
                        >
                          <option value="balanced">平衡 - 兼具深度与趣味</option>
                          <option value="playful">活泼 - 轻松有趣游戏化</option>
                          <option value="professional">专业 - 数据驱动严谨</option>
                          <option value="artistic">文艺 - 诗意隐喻感性</option>
                          <option value="experimental">实验 - 前卫大胆新奇</option>
                          <option value="custom">🎨 自定义风格...</option>
                        </select>
                        {field.value.startsWith('custom:') && (
                          <textarea
                            id={`report-${field.key}-custom`}
                            value={field.value.replace('custom:', '')}
                            onChange={(e) => updateReportFieldValue(field.key, `custom:${e.target.value}`)}
                            placeholder="例如：科幻未来风格，使用太空、AI、机器人等元素..."
                            rows={3}
                            className="field-input custom-textarea"
                          />
                        )}
                      </>
                    ) : (
                      <input
                        id={`report-${field.key}`}
                        type={field.field_type}
                        value={field.value}
                        onChange={(e) => updateReportFieldValue(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="field-input"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 虚拟人设配置 */}
          {activeSection === 'persona' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-persona">🎭</span>
                  <div>
                    <h2 className="section-title">虚拟人设配置</h2>
                    <p className="section-description">配置虚拟人设图片生成服务</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="info-card">
                  <p className="info-title">使用说明</p>
                  <p className="info-text">
                    <strong>Pollinations AI</strong>：完全免费，响应快速（&lt;1秒），适合开发测试和快速迭代<br/>
                    <strong>ImaginePro</strong>：专业 Midjourney API，图片质量极高，适合生产环境（需付费订阅）<br/>
                    AI 会根据你的数据生成独特的虚拟人设，点击首页右上角的圆形头像查看
                  </p>
                </div>

                <div className="ai-status-card">
                  <div className="status-info">
                    <p className="status-label">启用虚拟人设</p>
                    <p className="status-sublabel">根据个人数据生成虚拟人物设定</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={config.persona_config.config_fields.find(f => f.key === 'persona_image_enabled')?.value === 'true'}
                      onChange={(e) => updatePersonaFieldValue('persona_image_enabled', e.target.checked.toString())}
                      aria-label="Enable Virtual Persona"
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="config-field">
                  <label className="field-label">图片生成服务</label>
                  <div className="provider-selector">
                    <button
                      type="button"
                      onClick={() => updatePersonaFieldValue('persona_image_provider', 'pollinations')}
                      className={`provider-option ${
                        config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'pollinations'
                          ? 'active'
                          : ''
                      }`}
                    >
                      <span className="provider-icon">🆓</span>
                      <span className="provider-name">Pollinations AI</span>
                      <span className="provider-badge">免费</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updatePersonaFieldValue('persona_image_provider', 'imaginepro')}
                      className={`provider-option ${
                        config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'imaginepro'
                          ? 'active'
                          : ''
                      }`}
                    >
                      <span className="provider-icon">✨</span>
                      <span className="provider-name">ImaginePro</span>
                      <span className="provider-badge">Midjourney</span>
                    </button>
                  </div>
                </div>

                {config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'pollinations' && (
                  <>
                    <div className="config-field">
                      <label htmlFor="persona-model" className="field-label">AI 模型</label>
                      <select
                        id="persona-model"
                        value={config.persona_config.config_fields.find(f => f.key === 'persona_image_model')?.value || 'flux-anime'}
                        onChange={(e) => updatePersonaFieldValue('persona_image_model', e.target.value)}
                        className="field-select"
                      >
                        <option value="flux-anime">Flux Anime (推荐)</option>
                        <option value="flux">Flux (默认)</option>
                        <option value="flux-realism">Flux Realism (写实)</option>
                        <option value="flux-3d">Flux 3D (3D风格)</option>
                      </select>
                    </div>

                    <div className="dimension-grid">
                      <div className="config-field">
                        <label htmlFor="persona-width" className="field-label">宽度 (px)</label>
                        <input
                          id="persona-width"
                          type="number"
                          min="256"
                          max="1024"
                          step="64"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_width')?.value || '512'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_width', e.target.value)}
                          className="field-input"
                        />
                      </div>
                      <div className="config-field">
                        <label htmlFor="persona-height" className="field-label">高度 (px)</label>
                        <input
                          id="persona-height"
                          type="number"
                          min="256"
                          max="1024"
                          step="64"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_height')?.value || '768'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_height', e.target.value)}
                          className="field-input"
                        />
                      </div>
                    </div>
                  </>
                )}

                {config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'imaginepro' && (
                  <>
                    <div className="config-field">
                      <label htmlFor="imaginepro-key" className="field-label">
                        API Key <span className="required">*</span>
                      </label>
                      <input
                        id="imaginepro-key"
                        type="password"
                        value={config.persona_config.config_fields.find(f => f.key === 'imaginepro_api_key')?.value || ''}
                        onChange={(e) => updatePersonaFieldValue('imaginepro_api_key', e.target.value)}
                        placeholder="从 imaginepro.ai 获取"
                        className="field-input"
                      />
                    </div>

                    <div className="dimension-grid">
                      <div className="config-field">
                        <label htmlFor="persona-width-mj" className="field-label">宽度 (px)</label>
                        <input
                          id="persona-width-mj"
                          type="number"
                          min="512"
                          max="2048"
                          step="128"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_width')?.value || '1024'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_width', e.target.value)}
                          className="field-input"
                        />
                      </div>
                      <div className="config-field">
                        <label htmlFor="persona-height-mj" className="field-label">高度 (px)</label>
                        <input
                          id="persona-height-mj"
                          type="number"
                          min="512"
                          max="2048"
                          step="128"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_height')?.value || '1536'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_height', e.target.value)}
                          className="field-input"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* UI配置 */}
          {activeSection === 'ui' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-ui">🎨</span>
                  <div>
                    <h2 className="section-title">UI界面配置</h2>
                    <p className="section-description">自定义背景、主题等界面样式</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="metadata-section">
                  <h3 className="section-subtitle">🌐 网站元数据</h3>
                  {config.ui_config.config_fields
                    .filter((field) => ['site_title', 'site_description', 'site_favicon'].includes(field.key))
                    .map((field) => (
                      <div key={field.key} className="config-field">
                        <label htmlFor={`ui-${field.key}`} className="field-label">
                          {field.label}
                          {field.required && <span className="required">*</span>}
                        </label>
                        {field.key === 'site_description' ? (
                          <textarea
                            id={`ui-${field.key}`}
                            value={field.value}
                            onChange={(e) => updateUiFieldValue(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            rows={2}
                            className="field-input resizable-textarea"
                          />
                        ) : (
                          <input
                            id={`ui-${field.key}`}
                            type={field.field_type}
                            value={field.value}
                            onChange={(e) => updateUiFieldValue(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            className="field-input"
                          />
                        )}
                      </div>
                    ))}
                </div>

                <div>
                  <h3 className="section-subtitle">🎨 背景和主题</h3>
                  {config.ui_config.config_fields
                    .filter((field) => !field.key.startsWith('pet_') && !field.key.startsWith('github_') && !field.key.startsWith('music_') && !['site_title', 'site_description', 'site_favicon'].includes(field.key))
                    .map((field) => (
                      <div key={field.key} className="config-field">
                        <label htmlFor={`ui-${field.key}`} className="field-label">
                          {field.label}
                          {field.required && <span className="required">*</span>}
                        </label>
                        <input
                          id={`ui-${field.key}`}
                          type={field.field_type}
                          value={field.value}
                          onChange={(e) => updateUiFieldValue(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          min={field.field_type === 'number' ? '0' : undefined}
                          max={field.field_type === 'number' ? '10' : undefined}
                          className="field-input"
                        />
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* OAuth配置 */}
          {activeSection === 'oauth' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-oauth">🔐</span>
                  <div>
                    <h2 className="section-title">GitHub OAuth配置</h2>
                    <p className="section-description">配置GitHub OAuth应用以启用社交登录</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="info-card info-card-spaced">
                  <p className="info-title">如何获取 GitHub OAuth 凭证</p>
                  <p className="info-text">
                    1. 访问 <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer">GitHub Developer Settings</a><br/>
                    2. 点击 "New OAuth App" 创建新应用<br/>
                    3. 填写应用信息，Callback URL 填写：<code className="inline-code">{API_URL}/api/auth/github/callback</code><br/>
                    4. 创建后复制 Client ID 和生成 Client Secret
                  </p>
                </div>

                <div className="config-field">
                  <label htmlFor="github-client-id" className="field-label">
                    GitHub Client ID <span className="required">*</span>
                  </label>
                  <input
                    id="github-client-id"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_client_id')?.value || ''}
                    onChange={(e) => updateUiFieldValue('github_client_id', e.target.value)}
                    placeholder="GitHub OAuth App 的 Client ID"
                    className="field-input"
                  />
                </div>

                <div className="config-field">
                  <label htmlFor="github-client-secret" className="field-label">
                    GitHub Client Secret <span className="required">*</span>
                  </label>
                  <input
                    id="github-client-secret"
                    type="password"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_client_secret')?.value || ''}
                    onChange={(e) => updateUiFieldValue('github_client_secret', e.target.value)}
                    placeholder="GitHub OAuth App 的 Client Secret"
                    className="field-input"
                  />
                </div>

                <div className="config-field">
                  <label htmlFor="github-redirect-url" className="field-label">Redirect URL</label>
                  <input
                    id="github-redirect-url"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_redirect_url')?.value || `${API_URL}/api/auth/github/callback`}
                    onChange={(e) => updateUiFieldValue('github_redirect_url', e.target.value)}
                    placeholder={`${API_URL}/api/auth/github/callback`}
                    className="field-input"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 音乐播放器配置 */}
          {activeSection === 'music' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-music">🎵</span>
                  <div>
                    <h2 className="section-title">音乐播放器</h2>
                    <p className="section-description">配置歌单播放</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="info-card">
                  <p className="info-title">音乐播放器说明</p>
                  <p className="info-text">
                    在控制岛中播放指定歌单的音乐，支持网易云音乐和QQ音乐<br/>
                    播放有歌词的歌曲时，收缩状态下会自动显示实时歌词
                  </p>
                  <p className="info-text" style={{ marginTop: '0.5rem', color: '#f59e0b' }}>
                    ⚠️ 注意：网易云音乐API有地理位置限制，海外IP可能无法播放部分歌曲。<br/>
                    建议海外用户使用QQ音乐，或确保使用国内可访问的歌单。
                  </p>
                </div>

                <div className="ai-status-card">
                  <div className="status-info">
                    <p className="status-label">启用音乐播放器</p>
                    <p className="status-sublabel">在控制岛中显示音乐播放器</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={config.ui_config.config_fields.find(f => f.key === 'music_enabled')?.value === 'true'}
                      onChange={(e) => updateUiFieldValue('music_enabled', e.target.checked.toString())}
                      aria-label="Enable Music Player"
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="config-field">
                  <label className="field-label">音乐平台</label>
                  <div className="provider-selector">
                    <button
                      type="button"
                      onClick={() => updateUiFieldValue('music_source', 'netease')}
                      className={`provider-option ${
                        config.ui_config.config_fields.find(f => f.key === 'music_source')?.value === 'netease'
                          ? 'active'
                          : ''
                      }`}
                    >
                      <span className="provider-icon">🎵</span>
                      <span className="provider-name">网易云音乐</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateUiFieldValue('music_source', 'qq')}
                      className={`provider-option ${
                        config.ui_config.config_fields.find(f => f.key === 'music_source')?.value === 'qq'
                          ? 'active'
                          : ''
                      }`}
                    >
                      <span className="provider-icon">🎧</span>
                      <span className="provider-name">QQ音乐</span>
                    </button>
                  </div>
                </div>

                <div className="config-field">
                  <label htmlFor="music-playlist-id" className="field-label">
                    歌单ID <span className="required">*</span>
                  </label>
                  <input
                    id="music-playlist-id"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'music_playlist_id')?.value || ''}
                    onChange={(e) => updateUiFieldValue('music_playlist_id', e.target.value)}
                    placeholder={config.ui_config.config_fields.find(f => f.key === 'music_source')?.value === 'netease'
                      ? '例如: 2884035'
                      : '例如: 8039305244'}
                    className="field-input"
                  />
                  <p className="field-hint">
                    {config.ui_config.config_fields.find(f => f.key === 'music_source')?.value === 'netease'
                      ? '网易云音乐歌单链接中的数字ID，如 https://music.163.com/#/playlist?id=2884035'
                      : 'QQ音乐歌单链接中的数字ID，如 https://y.qq.com/n/ryqq/playlist/8039305244'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 宠物配置 */}
          {activeSection === 'pet' && (
            <div className="config-section">
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-pet">🐱</span>
                  <div>
                    <h2 className="section-title">宠物吉祥物</h2>
                    <p className="section-description">可爱的行走角色</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="ai-status-card">
                  <div className="status-info">
                    <p className="status-label">启用宠物</p>
                    <p className="status-sublabel">在报告信息卡上显示行走的宠物角色</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={config.ui_config.config_fields.find(f => f.key === 'pet_enabled')?.value === 'true'}
                      onChange={(e) => updateUiFieldValue('pet_enabled', e.target.checked.toString())}
                      aria-label="Enable Pet Mascot"
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="config-field">
                  <label htmlFor="pet-image-url" className="field-label">宠物图片 URL</label>
                  <input
                    id="pet-image-url"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'pet_image_url')?.value || ''}
                    onChange={(e) => updateUiFieldValue('pet_image_url', e.target.value)}
                    placeholder="宠物角色图片的URL"
                    className="field-input"
                  />
                </div>

                {config.ui_config.config_fields.find(f => f.key === 'pet_image_url')?.value && (
                  <div className="info-card">
                    <p className="info-title">预览</p>
                    <div className="pet-preview-container">
                      <img
                        src={config.ui_config.config_fields.find(f => f.key === 'pet_image_url')?.value}
                        alt="Pet preview"
                        className="pet-preview-image"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 平台配置弹窗 */}
      {platformModalOpen && config && (() => {
        const platformIndex = config.platforms.findIndex(p => p.name === platformModalOpen);
        if (platformIndex === -1) return null;
        const platform = config.platforms[platformIndex];

        return (
          <div className="modal-overlay" onClick={() => setPlatformModalOpen(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title-section">
                  <div className="platform-icon-wrapper">
                    <PlatformIcon platform={platform.name} className="platform-icon" />
                  </div>
                  <div>
                    <h3 className="modal-title">{platform.name}</h3>
                    <p className="modal-subtitle">{platform.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => setPlatformModalOpen(null)}
                  className="modal-close-button"
                  aria-label="关闭"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="modal-body">
                {platform.config_fields.map((field) => (
                  <div key={field.key} className="config-field">
                    <label htmlFor={`modal-platform-${platformIndex}-${field.key}`} className="field-label">
                      {field.label}
                      {field.required && <span className="required">*</span>}
                    </label>
                    <input
                      id={`modal-platform-${platformIndex}-${field.key}`}
                      type={field.field_type}
                      value={field.value}
                      onChange={(e) => updateFieldValue(platformIndex, field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="field-input"
                    />
                  </div>
                ))}

                <button
                  onClick={() => handleTest(platform.name)}
                  disabled={testing === platform.name}
                  className="test-button"
                >
                  {testing === platform.name ? (
                    <>
                      <div className="button-spinner"></div>
                      <span>测试中...</span>
                    </>
                  ) : (
                    <>
                      <span>🔍</span>
                      <span>测试连接</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ModernConfigForm;
