import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motionShim as motion } from '@lib/motionShim';
import { API_URL } from '@/config';
import PlatformIcon from './PlatformIcon';
import Toast from './Toast';
import { ButtonSpinner } from './Spinner';
import { FaSearch, FaTimes, FaStar } from '@lib/icons';
import { SiNeteasecloudmusic } from '@lib/icons';
import { fetchJson } from '../utils/apiHelper';
import { fetchConfig } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { getCSRFToken } from '../utils/csrf';
import { clearPlaylistCache } from '../utils/musicPlayer';
import { useI18n } from '../contexts/I18nContext';
import './ConfigForm.css';

// 懒加载配置组件（待后续优化时启用）
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
  const { t } = useI18n();
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

  // 获取翻译后的字段标签（覆盖后端返回的标签）
  const getFieldLabel = useCallback((fieldKey: string, originalLabel: string): string => {
    const fieldLabels: Record<string, string> = {
      'wallpaper_url': t.config.fieldWallpaperUrl,
      'wallpaper_blur': t.config.fieldWallpaperBlur,
      'wallpaper_parallax': t.config.fieldWallpaperParallax,
      'pet_enabled': t.config.fieldPetEnabled,
      'pet_image_url': t.config.fieldPetImageUrl,
      'site_title': t.config.fieldSiteTitle,
      'site_description': t.config.fieldSiteDescription,
      'site_favicon': t.config.fieldSiteFavicon,
      'music_enabled': t.config.fieldMusicEnabled,
      'music_source': t.config.fieldMusicSource,
      'music_playlist_id': t.config.fieldMusicPlaylistId,
    };
    return fieldLabels[fieldKey] || originalLabel;
  }, [t]);

  // 获取翻译后的占位符
  const getFieldPlaceholder = useCallback((fieldKey: string, originalPlaceholder: string): string => {
    const placeholders: Record<string, string> = {
      'wallpaper_url': t.config.placeholderWallpaperUrl,
      'site_title': t.config.placeholderSiteTitle,
      'site_description': t.config.placeholderSiteDescription,
      'site_favicon': t.config.placeholderSiteFavicon,
      'pet_image_url': t.config.placeholderPetImageUrl,
    };
    return placeholders[fieldKey] || originalPlaceholder;
  }, [t]);

  // 使用防抖优化搜索性能 - 避免频繁搜索
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // 快速访问项（使用 useMemo 避免每次渲染重新创建数组）
  const quickAccessItems: QuickAccessItem[] = useMemo(() => [
    { id: 'platforms', label: t.config.platforms, icon: '🌐', section: 'platforms' },
    { id: 'data', label: t.config.data, icon: '💾', section: 'data' },
    { id: 'ai', label: t.config.ai, icon: '🤖', section: 'ai' },
    { id: 'persona', label: t.config.persona, icon: '🎭', section: 'persona' },
    { id: 'ui', label: t.config.ui, icon: '🎨', section: 'ui' },
    { id: 'music', label: t.config.music, icon: '🎵', section: 'music' },
    { id: 'oauth', label: t.config.oauth, icon: '🔐', section: 'oauth' },
  ], [t]);

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
      title: t.config.ai,
      description: t.config.aiDesc,
      keywords: ['ai', 'gemini', 'openai', 'api', '模型', '智能']
    });
    
    // 虚拟人设
    items.push({
      type: 'section',
      section: 'persona',
      title: t.config.persona,
      description: t.config.personaDesc,
      keywords: ['虚拟', '人设', 'persona', '图片', '生成', 'ai']
    });
    
    // UI配置
    items.push({
      type: 'section',
      section: 'ui',
      title: t.config.ui,
      description: t.config.uiDesc,
      keywords: ['ui', '界面', '主题', '背景', '样式', 'theme']
    });
    
    // OAuth配置
    items.push({
      type: 'section',
      section: 'oauth',
      title: t.config.oauth,
      description: t.config.oauthDesc,
      keywords: ['oauth', 'github', '登录', 'auth', '认证']
    });
    
    // 音乐播放器
    items.push({
      type: 'section',
      section: 'music',
      title: t.config.music,
      description: t.config.musicDesc,
      keywords: ['音乐', 'music', '歌单', '播放器', '网易云', 'qq音乐']
    });

    return items;
  }, [config, t]);

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
          detail: { success: false, message: t.config.configEmpty },
        })
      );
      return;
    }

    setMessage(t.config.savingConfig);

    try {
      // 获取 CSRF Token
      const csrfToken = await getCSRFToken(true);
      if (!csrfToken) {
        throw new Error(t.userModal.cannotGetCsrf);
      }

      const result = await fetchJson(
        `${API_URL}/api/config`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify(config),
        },
        t.config.configSaveFailed
      );
      
      setMessage(`✓ ${t.config.configSaved} ${t.config.refreshing}`);
      notifyDirtyState(false);
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: true, message: result.message || t.config.configSaved },
        })
      );

      try {
        // reload-config 也需要 CSRF Token
        const reloadCsrfToken = await getCSRFToken(true);
        await fetchJson(
          `${API_URL}/api/system/reload-config`,
          {
            method: 'POST',
            headers: {
              'X-CSRF-Token': reloadCsrfToken || '',
            },
            credentials: 'include'
          },
          t.config.refreshFailed
        );

        setMessage(`✓ ${t.config.savedSuccess}`);
        
        // 等待后端完成配置保存和环境变量重新加载，然后刷新页面
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } catch (restartError) {
        setMessage(`✓ ${t.config.savedSuccess}`);
        // 即使刷新配置失败，仍然刷新页面以应用数据库中的新配置
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } catch (error) {
      const errorMsg = `✗ ${t.config.configSaveFailed}: ` + (error instanceof Error ? error.message : t.errors.networkError);
      setMessage(errorMsg);
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: { success: false, message: errorMsg },
        })
      );
    }
  }, [config]);

  const handleReset = React.useCallback(async () => {
    setMessage(t.config.resettingConfig);
    
    try {
      const data = await fetchConfig();
      
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
            return { ...field, value: defaultValue };
          }),
        },
      };
      
      setConfig(clearedData);
      notifyDirtyState(false);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      setMessage(t.config.savingDefault);
      
      // 获取 CSRF Token
      const resetCsrfToken = await getCSRFToken(true);
      if (!resetCsrfToken) {
        throw new Error(t.userModal.cannotGetCsrf);
      }
      
      const saveResult = await fetchJson(
        `${API_URL}/api/config`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRF-Token': resetCsrfToken,
          },
          credentials: 'include',
          body: JSON.stringify(clearedData),
        },
        t.config.configSaveFailed
      );

      setMessage(`✓ ${t.config.configReset}`);
      setTimeout(() => setMessage(''), 5000);
      
      window.dispatchEvent(
        new CustomEvent('config-reset-result', {
          detail: { success: true, message: saveResult.message || t.config.configReset },
        })
      );
    } catch (error) {
      const errorMsg = `${t.config.resetFailed}` + (error instanceof Error ? error.message : t.errors.unknown);
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
      const data = await fetchConfig();
      setConfig(data);
      notifyDirtyState(false);

      const event = new CustomEvent('config-loaded', { detail: data });
      window.dispatchEvent(event);
    } catch (error) {
      setMessage(t.config.loadConfigFailed);
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

      // 获取 CSRF Token
      const testCsrfToken = await getCSRFToken(true);
      if (!testCsrfToken) {
        throw new Error(t.userModal.cannotGetCsrf);
      }

      const result = await fetchJson(
        `${API_URL}/api/config/test`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRF-Token': testCsrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            platform: platformName,
            config: configObj,
          }),
        },
        t.config.testFailed
      );

      setMessage(result.message);
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      setMessage(`✗ ${t.config.testFailed}`);
    } finally {
      setTesting(null);
    }
  }, [config]);

  const updateConfigField = React.useCallback((
    section: 'ai' | 'persona' | 'ui',
    fieldKey: string,
    value: string,
    providerFieldKey?: string
  ) => {
    if (!config) return;

    const sectionKey = `${section}_config` as 'ai_config' | 'persona_config' | 'ui_config';
    const sectionConfig = config[sectionKey];
    const newFields = [...sectionConfig.config_fields];
    const field = newFields.find(f => f.key === fieldKey);

    if (field) {
      // 🔒 安全措施：如果新值包含掩码字符，说明用户在掩码上直接输入，需要清除掩码
      const isMasked = (val: string) => val.includes('••') || val.includes('**') || val === '********';
      if (isMasked(value) && value !== '••••••••' && value !== '********') {
        // 移除所有掩码字符，只保留用户新输入的内容
        field.value = value.replace(/[•*]+/g, '');
      } else {
        field.value = value;
      }

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
      // 🔒 安全措施：如果新值包含掩码字符，说明用户在掩码上直接输入，需要清除掩码
      // 检测是否在掩码基础上输入（例如 "a••••••••"）
      const isMasked = (val: string) => val.includes('••') || val.includes('**') || val === '********';
      if (isMasked(value) && value !== '••••••••' && value !== '********') {
        // 移除所有掩码字符，只保留用户新输入的内容
        field.value = value.replace(/[•*]+/g, '');
      } else {
        field.value = value;
      }
      setConfig({ ...config, platforms: newPlatforms });
      notifyDirtyState(true);
    }
  }, [config, notifyDirtyState]);

  const updateAiFieldValue = React.useCallback((fieldKey: string, value: string) => {
    updateConfigField('ai', fieldKey, value, 'provider');
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
    return null;
  }

  if (!config) {
    return (
      <div className="modern-config-error">
        <span className="error-icon">⚠️</span>
        <p>{t.config.loadConfigFailed}</p>
      </div>
    );
  }

  return (
    <motion.div 
      className="modern-config-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
    >
      {/* 消息提示 */}
      {message && <Toast message={message} />}

      {/* 配置导航卡片 */}
      <motion.div 
        className="config-nav-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        <div className="config-nav-header">
          <div className="nav-header-left">
            <span className="nav-icon">🛠️</span>
            <div>
              <h3 className="nav-title">{t.config.title}</h3>
              <p className="nav-subtitle">{t.config.selectProject}</p>
            </div>
          </div>
          <div className="nav-header-actions">
            <button
              onClick={handleReset}
              className="btn-base btn-danger nav-action-button reset-button"
              aria-label={t.config.resetConfigLabel}
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{t.config.resetConfig}</span>
            </button>
            <button
              onClick={handleSave}
              className="btn-base btn-primary nav-action-button save-button"
              aria-label={t.config.saveConfigLabel}
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{t.config.saveConfig}</span>
            </button>
          </div>
        </div>
        
        {/* 搜索栏 */}
        <div className="config-search-bar">
          <div className="search-input-wrapper">
            <FaSearch className="search-icon" />
            <input
              type="text"
              placeholder={t.config.searchConfig}
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
              {t.config.searchResults} ({filteredContent.length})
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
                  <p>{t.config.noMatchingConfig}</p>
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
                  <span className="nav-section-title">{t.config.favorites}</span>
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
                <span className="nav-section-title">{t.config.allConfig}</span>
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
      </motion.div>

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
                    <h2 className="section-title">{t.config.platforms}</h2>
                    <p className="section-description">{t.config.platformsDesc}</p>
                  </div>
                </div>
              </div>

              <div className="platforms-grid">
                {config.platforms.map((platform, index) => (
                  <motion.div 
                    key={platform.name} 
                    className="platform-card"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + index * 0.05, duration: 0.3 }}
                    onClick={() => setPlatformModalOpen(platform.name)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="platform-header">
                      <div className="platform-info">
                        <div className="platform-icon-wrapper">
                          <PlatformIcon platform={platform.name} className="platform-icon" />
                        </div>
                        <div className="platform-details">
                          <div className="platform-title-row">
                            <h3 className="platform-name">{platform.name}</h3>
                            <span className={`status-badge ${(() => {
                              // GitHub只需要username即可，token是可选的
                              if (platform.name.toLowerCase() === 'github') {
                                const usernameField = platform.config_fields.find(f => f.key === 'username');
                                return platform.enabled && usernameField?.value ? 'configured' : 'unconfigured';
                              }
                              // 其他平台需要token
                              return platform.enabled && platform.has_token ? 'configured' : 'unconfigured';
                            })()}`}>
                              {(() => {
                                if (platform.name.toLowerCase() === 'github') {
                                  const usernameField = platform.config_fields.find(f => f.key === 'username');
                                  return platform.enabled && usernameField?.value ? `✓ ${t.config.configured}` : `⚠ ${t.config.notConfigured}`;
                                }
                                return platform.enabled && platform.has_token ? `✓ ${t.config.configured}` : `⚠ ${t.config.notConfigured}`;
                              })()}
                            </span>
                          </div>
                          <p className="platform-desc">{platform.description}</p>
                        </div>
                      </div>
                      <div className="platform-actions">
                        <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={platform.enabled}
                            onChange={() => togglePlatform(index)}
                            aria-label={`Enable ${platform.name}`}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* AI配置 */}
          {activeSection === 'ai' && (
            <motion.div 
              className="config-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-ai">🤖</span>
                  <div>
                    <h2 className="section-title">{t.config.aiConfigTitle}</h2>
                    <p className="section-description">{t.config.aiConfigDesc}</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                {/* 功能介绍 */}
                <div className="info-card">
                  <p className="info-title">{t.config.aiServiceInfoTitle}</p>
                  <p className="info-text">
                    {t.config.aiServiceInfoDescription}<br/>
                    <strong>Google Gemini</strong>: {t.config.geminiDescription}<a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer">{t.config.getApiKey}</a><br/>
                    <strong>{t.config.openaiCompatible}</strong>: {t.config.openaiDescription}
                  </p>
                </div>

                {/* Provider选择和状态 - 横向布局 */}
                <div className="config-field-row">
                  <div className="field-label-inline">
                    <span>{t.config.aiProvider} <span className="required">*</span></span>
                    <span className="field-hint">{t.config.aiProviderHint}</span>
                  </div>
                  <div className="field-control" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div className="provider-selector">
                      {(() => {
                        const providerField = config.ai_config.config_fields.find(f => f.key === 'provider');
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => updateAiFieldValue('provider', 'gemini')}
                              className={`provider-option ${providerField?.value === 'gemini' ? 'active' : ''}`}
                            >
                              <span className="provider-icon">🤖</span>
                              <span className="provider-name">Gemini</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateAiFieldValue('provider', 'openai')}
                              className={`provider-option ${providerField?.value === 'openai' ? 'active' : ''}`}
                            >
                              <span className="provider-icon">✨</span>
                              <span className="provider-name">OpenAI</span>
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

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
                          onFocus={(e) => {
                            // 🔒 如果是掩码值，自动选中全部内容，用户输入会直接替换
                            const isMasked = e.target.value === '••••••••' || e.target.value === '********';
                            if (isMasked) {
                              e.target.select();
                            }
                          }}
                          placeholder={field.placeholder}
                          className="field-input"
                        />
                      </div>
                    ));
                })()}
              </div>
            </motion.div>
          )}

          {/* 虚拟人设配置 */}
          {activeSection === 'persona' && (
            <motion.div 
              className="config-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-persona">🎭</span>
                  <div>
                    <h2 className="section-title">{t.config.personaConfigTitle}</h2>
                    <p className="section-description">{t.config.personaConfigDesc}</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="info-card">
                  <p className="info-title">{t.config.personaUsageTitle}</p>
                  <p className="info-text">
                    <strong>Pollinations AI</strong>：{t.config.pollinationsDescription}<br/>
                    <strong>ImaginePro</strong>：{t.config.imagineproDescription}<br/>
                    {t.config.personaUsageDescription}
                  </p>
                </div>

                {/* 开关和Provider选择 - 横向布局 */}
                <div className="config-field-row">
                  <div className="field-label-inline">
                    <span>{t.config.enableVirtualPersona}</span>
                    <span className="field-hint">{t.config.virtualPersonaDesc}</span>
                  </div>
                  <div className="field-control">
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
                </div>

                <div className="config-field-row">
                  <div className="field-label-inline">
                    <span>{t.config.imageGenService}</span>
                  </div>
                  <div className="field-control">
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
                        <span className="provider-name">Pollinations</span>
                        <span className="provider-badge">{t.config.pollinationsFree}</span>
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
                        <span className="provider-badge">MJ</span>
                      </button>
                    </div>
                  </div>
                </div>

                {config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'pollinations' && (
                  <div className="config-compact-group">
                    <div className="config-field">
                      <label htmlFor="persona-model" className="field-label">{t.config.aiModel}</label>
                      <select
                        id="persona-model"
                        value={config.persona_config.config_fields.find(f => f.key === 'persona_image_model')?.value || 'flux-anime'}
                        onChange={(e) => updatePersonaFieldValue('persona_image_model', e.target.value)}
                        className="field-select"
                      >
                        <option value="flux-anime">{t.config.fluxAnimeRecommend}</option>
                        <option value="flux">{t.config.fluxDefault}</option>
                        <option value="flux-realism">{t.config.fluxRealism}</option>
                        <option value="flux-3d">{t.config.flux3D}</option>
                      </select>
                    </div>
                    <div className="config-field">
                      <label htmlFor="persona-width" className="field-label">{t.config.width}</label>
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
                      <label htmlFor="persona-height" className="field-label">{t.config.height}</label>
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
                        onFocus={(e) => {
                          const isMasked = e.target.value === '••••••••' || e.target.value === '********';
                          if (isMasked) {
                            e.target.select();
                          }
                        }}
                        placeholder={t.config.imagineproPlaceholder}
                        className="field-input"
                      />
                    </div>

                    <div className="config-compact-group">
                      <div className="config-field">
                        <label htmlFor="persona-width-mj" className="field-label">{t.config.width}</label>
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
                        <label htmlFor="persona-height-mj" className="field-label">{t.config.height}</label>
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
            </motion.div>
          )}

          {/* UI配置 */}
          {activeSection === 'ui' && (
            <motion.div 
              className="config-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-ui">🎨</span>
                  <div>
                    <h2 className="section-title">{t.config.uiConfigTitle}</h2>
                    <p className="section-description">{t.config.uiConfigDesc}</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="metadata-section">
                  <h3 className="section-subtitle">🌐 {t.config.siteMetadata}</h3>
                  {config.ui_config.config_fields
                    .filter((field) => ['site_title', 'site_description', 'site_favicon'].includes(field.key))
                    .map((field) => (
                      <div key={field.key} className="config-field">
                        <label htmlFor={`ui-${field.key}`} className="field-label">
                          {getFieldLabel(field.key, field.label)}
                          {field.required && <span className="required">*</span>}
                        </label>
                        {field.key === 'site_description' ? (
                          <textarea
                            id={`ui-${field.key}`}
                            value={field.value}
                            onChange={(e) => updateUiFieldValue(field.key, e.target.value)}
                            placeholder={getFieldPlaceholder(field.key, field.placeholder)}
                            rows={2}
                            className="field-input resizable-textarea"
                          />
                        ) : (
                          <input
                            id={`ui-${field.key}`}
                            type={field.field_type}
                            value={field.value}
                            onChange={(e) => updateUiFieldValue(field.key, e.target.value)}
                            placeholder={getFieldPlaceholder(field.key, field.placeholder)}
                            className="field-input"
                          />
                        )}
                      </div>
                    ))}
                </div>

                <div>
                  <h3 className="section-subtitle">🎨 {t.config.backgroundAndTheme}</h3>
                  {config.ui_config.config_fields
                    .filter((field) => !field.key.startsWith('pet_') && !field.key.startsWith('github_') && !field.key.startsWith('music_') && !['site_title', 'site_description', 'site_favicon'].includes(field.key))
                    .map((field) => (
                      <div key={field.key} className="config-field">
                        <label htmlFor={`ui-${field.key}`} className="field-label">
                          {getFieldLabel(field.key, field.label)}
                          {field.required && <span className="required">*</span>}
                        </label>
                        {field.field_type === 'checkbox' ? (
                          <div className="checkbox-wrapper">
                            <input
                              id={`ui-${field.key}`}
                              type="checkbox"
                              checked={field.value === 'true'}
                              onChange={(e) => updateUiFieldValue(field.key, e.target.checked ? 'true' : 'false')}
                              className="field-checkbox"
                            />
                            <span className="checkbox-hint">
                              {field.key === 'wallpaper_parallax' && t.config.wallpaperParallaxHint}
                            </span>
                          </div>
                        ) : (
                          <input
                            id={`ui-${field.key}`}
                            type={field.field_type}
                            value={field.value}
                            onChange={(e) => updateUiFieldValue(field.key, e.target.value)}
                            placeholder={getFieldPlaceholder(field.key, field.placeholder)}
                            min={field.field_type === 'number' ? '0' : undefined}
                            max={field.field_type === 'number' ? '10' : undefined}
                            className="field-input"
                          />
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* OAuth配置 */}
          {activeSection === 'oauth' && (
            <motion.div 
              className="config-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-oauth">🔐</span>
                  <div>
                    <h2 className="section-title">{t.config.oauthConfigTitle}</h2>
                    <p className="section-description">{t.config.oauthConfigDesc}</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="info-card info-card-spaced">
                  <p className="info-title">{t.config.oauthGuideTitle}</p>
                  <p className="info-text">
                    1. {t.config.oauthGuideStep1} <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer">GitHub Developer Settings</a><br/>
                    2. {t.config.oauthGuideStep2}<br/>
                    3. {t.config.oauthGuideStep3} <code className="inline-code">{API_URL}/api/auth/github/callback</code><br/>
                    4. {t.config.oauthGuideStep4}
                  </p>
                </div>

                <div className="config-field">
                  <label htmlFor="github-client-id" className="field-label">
                    {t.config.githubClientId} <span className="required">*</span>
                  </label>
                  <input
                    id="github-client-id"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_client_id')?.value || ''}
                    onChange={(e) => updateUiFieldValue('github_client_id', e.target.value)}
                    placeholder={t.config.githubClientIdPlaceholder}
                    className="field-input"
                  />
                </div>

                <div className="config-field">
                  <label htmlFor="github-client-secret" className="field-label">
                    {t.config.githubClientSecret} <span className="required">*</span>
                  </label>
                  <input
                    id="github-client-secret"
                    type="password"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_client_secret')?.value || ''}
                    onChange={(e) => updateUiFieldValue('github_client_secret', e.target.value)}
                    onFocus={(e) => {
                      // 🔒 如果是掩码值，自动选中全部内容，用户输入会直接替换
                      const isMasked = e.target.value === '••••••••' || e.target.value === '********';
                      if (isMasked) {
                        e.target.select();
                      }
                    }}
                    placeholder={t.config.githubClientSecretPlaceholder}
                    className="field-input"
                  />
                </div>

                <div className="config-field">
                  <label htmlFor="github-redirect-url" className="field-label">{t.config.redirectUrl}</label>
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
            </motion.div>
          )}

          {/* 音乐播放器配置 */}
          {activeSection === 'music' && (
            <motion.div 
              className="config-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="section-header">
                <div className="section-header-left">
                  <span className="section-icon icon-music">🎵</span>
                  <div>
                    <h2 className="section-title">{t.config.musicConfigTitle}</h2>
                    <p className="section-description">{t.config.musicConfigDesc}</p>
                  </div>
                </div>
              </div>

              <div className="config-form">
                <div className="info-card">
                  <p className="info-title">{t.config.musicUsageTitle}</p>
                  <p className="info-text">
                    {t.config.musicUsageInfo}
                  </p>
                </div>

                {/* 开关和平台选择 - 横向布局 */}
                <div className="config-field-row">
                  <div className="field-label-inline">
                    <span>{t.config.enableMusicPlayer}</span>
                    <span className="field-hint">{t.config.musicPlayerDesc}</span>
                  </div>
                  <div className="field-control">
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
                </div>

                <div className="config-field-row">
                  <div className="field-label-inline">
                    <span>{t.config.musicPlatform}</span>
                  </div>
                  <div className="field-control">
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
                        <span className="provider-icon"><SiNeteasecloudmusic /></span>
                        <span className="provider-name">{t.config.neteaseMusic}</span>
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
                        <span className="provider-name">{t.config.qqMusic}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="config-field">
                  <label htmlFor="music-playlist-id" className="field-label">
                    {t.config.playlistId} <span className="required">*</span>
                  </label>
                  <input
                    id="music-playlist-id"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'music_playlist_id')?.value || ''}
                    onChange={(e) => updateUiFieldValue('music_playlist_id', e.target.value)}
                    placeholder={config.ui_config.config_fields.find(f => f.key === 'music_source')?.value === 'netease'
                      ? t.config.neteasePlaylistExample
                      : t.config.qqPlaylistExample}
                    className="field-input"
                  />
                  <p className="field-hint">
                    {config.ui_config.config_fields.find(f => f.key === 'music_source')?.value === 'netease'
                      ? t.config.neteasePlaylistHint
                      : t.config.qqPlaylistHint}
                  </p>
                </div>

                {/* 清理音乐缓存按钮 */}
                <div className="config-field" style={{ marginTop: '1.5rem' }}>
                  <label className="field-label">{t.config.cacheManagement}</label>
                  <p className="field-hint" style={{ marginBottom: '0.75rem' }}>
                    {t.config.clearMusicCacheDesc}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearPlaylistCache();
                      setMessage(t.config.musicCacheCleared);
                      setTimeout(() => setMessage(''), 3000);
                    }}
                    className="btn-base btn-secondary"
                    style={{ width: 'auto' }}
                  >
                    <span>🗑️</span>
                    <span>{t.config.clearMusicCacheBtn}</span>
                  </button>
                </div>
              </div>
            </motion.div>
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
                  aria-label={t.config.closeLabel}
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
                      onFocus={(e) => {
                        // 🔒 如果是掩码值，自动选中全部内容，用户输入会直接替换
                        const isMasked = e.target.value === '••••••••' || e.target.value === '********';
                        if (isMasked) {
                          e.target.select();
                        }
                      }}
                      placeholder={field.placeholder}
                      className="field-input"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </motion.div>
  );
};

export default ModernConfigForm;
