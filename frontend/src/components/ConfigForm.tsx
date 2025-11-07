import React, { useState, useEffect } from 'react';
import { API_URL } from '@/config';
import PlatformIcon from './PlatformIcon';
import { FaBrain } from 'react-icons/fa';
import { fetchJson } from '../utils/apiHelper';

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

const ConfigForm: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string>('platforms'); // 默认展开平台配置

  // 使用 useCallback 包装处理函数，避免闭包问题
  const handleSave = React.useCallback(async () => {
    if (!config) {
      window.dispatchEvent(
        new CustomEvent('config-save-result', {
          detail: {
            success: false,
            message: '配置为空，无法保存',
          },
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
          detail: {
            success: true,
            message: result.message || '配置已保存',
          },
        })
      );

      // Automatically trigger backend restart
      try {
        await fetchJson(
          `${API_URL}/api/system/restart`,
          { method: 'POST' },
          '重启后端失败'
        );

        setMessage('✓ 配置已保存！后端正在重启...');
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
          detail: {
            success: false,
            message: errorMsg,
          },
        })
      );
    }
  }, [config]);

  // 重置配置并自动保存
  const handleReset = React.useCallback(async () => {
    setMessage('正在重置配置...');
    
    try {
      // 加载配置结构
      const data = await fetchJson(`${API_URL}/api/config`, {}, '加载配置失败');
      
      // 清空所有配置字段的值
      const clearedData = {
        ...data,
        platforms: data.platforms.map((platform: any) => ({
          ...platform,
          enabled: false, // 禁用所有平台
          has_token: false,
          config_fields: platform.config_fields.map((field: any) => ({
            ...field,
            value: '', // 清空所有字段值
          })),
        })),
        ai_config: {
          ...data.ai_config,
          enabled: false,
          api_key: '',
          config_fields: data.ai_config.config_fields.map((field: any) => ({
            ...field,
            value: field.key === 'model' ? 'gemini-pro' : '', // 保留默认模型名
          })),
        },
        report_config: {
          ...data.report_config,
          config_fields: data.report_config.config_fields.map((field: any) => ({
            ...field,
            value: field.key === 'topic_style' ? 'balanced' : field.value, // 保留默认风格
          })),
        },
        persona_config: {
          ...data.persona_config,
          config_fields: data.persona_config.config_fields.map((field: any) => {
            // 保留虚拟人设配置的默认值
            let defaultValue = '';
            if (field.key === 'persona_image_enabled') {
              defaultValue = 'true';
            } else if (field.key === 'persona_image_provider') {
              defaultValue = 'pollinations';
            } else if (field.key === 'persona_image_model') {
              defaultValue = 'flux-anime';
            } else if (field.key === 'persona_image_width') {
              defaultValue = '512';
            } else if (field.key === 'persona_image_height') {
              defaultValue = '768';
            }
            return {
              ...field,
              value: defaultValue,
            };
          }),
        },
        ui_config: {
          ...data.ui_config,
          config_fields: data.ui_config.config_fields.map((field: any) => {
            // 保留UI配置的默认值
            let defaultValue = '';
            if (field.key === 'wallpaper_url') {
              defaultValue = 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809';
            } else if (field.key === 'wallpaper_blur') {
              defaultValue = '3';
            } else if (field.key === 'pet_enabled') {
              defaultValue = 'true';
            } else if (field.key === 'pet_image_url') {
              defaultValue = 'https://api.fuukei.org/myriad/frontend/public/furina.png';
            }
            return {
              ...field,
              value: defaultValue,
            };
          }),
        },
      };
      
      setConfig(clearedData);
      notifyDirtyState(false);
      
      // 等待一小段时间确保状态更新
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 自动保存
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
      
      // 通知重置完成
      window.dispatchEvent(
        new CustomEvent('config-reset-result', {
          detail: {
            success: true,
            message: saveResult.message || '配置已重置为默认值并保存',
          },
        })
      );
    } catch (error) {
      const errorMsg = '重置配置失败：' + (error instanceof Error ? error.message : '未知错误');
      setMessage(errorMsg);
      window.dispatchEvent(
        new CustomEvent('config-reset-result', {
          detail: {
            success: false,
            message: errorMsg,
          },
        })
      );
    }
  }, []);

  const handleRefreshPlatformData = React.useCallback(async () => {
    setMessage('');

    try {
      const result = await fetchJson(
        `${API_URL}/api/profile/fetch-all`,
        { method: 'POST' },
        '刷新平台数据失败'
      );

      if (result.success) {
        setMessage('✓ 平台数据刷新成功！');
        setTimeout(() => setMessage(''), 5000);
        
        // 触发缓存状态更新事件
        window.dispatchEvent(
          new CustomEvent('cache-status-update', { 
            detail: { 
              cached: true, 
              time: new Date().toISOString() 
            } 
          })
        );
        
        // 通知刷新完成
        window.dispatchEvent(
          new CustomEvent('platform-data-refresh-result', {
            detail: {
              success: true,
              message: result.message || '平台数据刷新成功',
            },
          })
        );
      }
    } catch (error) {
      setMessage('✗ 刷新平台数据失败');
      window.dispatchEvent(
        new CustomEvent('platform-data-refresh-result', {
          detail: {
            success: false,
            message: '刷新失败，请检查网络连接',
          },
        })
      );
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, []); // 只在组件挂载时执行一次

  // 单独的 effect 监听事件，依赖 handleSave 等函数
  useEffect(() => {
    // 监听来自页面的保存、重置和刷新事件
    const handleSaveEvent = () => {
      handleSave();
    };
    const handleResetEvent = () => {
      handleReset();
    };
    const handleRefreshEvent = () => {
      handleRefreshPlatformData();
    };

    window.addEventListener('request-config-save', handleSaveEvent);
    window.addEventListener('config-reset', handleResetEvent);
    window.addEventListener('request-platform-refresh', handleRefreshEvent);

    return () => {
      window.removeEventListener('request-config-save', handleSaveEvent);
      window.removeEventListener('config-reset', handleResetEvent);
      window.removeEventListener('request-platform-refresh', handleRefreshEvent);
    };
  }, [handleSave, handleReset, handleRefreshPlatformData]); // 依赖这些函数

  const notifyDirtyState = (dirty: boolean) => {
    window.dispatchEvent(
      new CustomEvent('config-dirty-state', {
        detail: { dirty },
      })
    );
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await fetchJson(`${API_URL}/api/config`, {}, '加载配置失败');
      setConfig(data);
      notifyDirtyState(false);
      
      // 触发配置加载完成事件，传递配置数据
      const event = new CustomEvent('config-loaded', { detail: data });
      window.dispatchEvent(event);
    } catch (error) {
      setMessage('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };



  const handleTest = async (platformName: string) => {
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
  };

  // 🚀 性能优化：统一的字段更新函数，消除代码重复
  const updateConfigField = (
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

      // 如果是 provider 字段变更，需要同时更新对应的 provider 属性
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
  };

  // 保留原有函数作为便捷包装器，向后兼容
  const updateFieldValue = (platformIndex: number, fieldKey: string, value: string) => {
    if (!config) return;

    const newPlatforms = [...config.platforms];
    const field = newPlatforms[platformIndex].config_fields.find(f => f.key === fieldKey);
    if (field) {
      field.value = value;
      setConfig({ ...config, platforms: newPlatforms });
      notifyDirtyState(true);
    }
  };

  const updateAiFieldValue = (fieldKey: string, value: string) => {
    updateConfigField('ai', fieldKey, value, 'provider');
  };

  const updateReportFieldValue = (fieldKey: string, value: string) => {
    updateConfigField('report', fieldKey, value);
  };

  const updatePersonaFieldValue = (fieldKey: string, value: string) => {
    updateConfigField('persona', fieldKey, value, 'persona_image_provider');
  };

  const updateUiFieldValue = (fieldKey: string, value: string) => {
    updateConfigField('ui', fieldKey, value);
  };

  const togglePlatform = (platformIndex: number) => {
    if (!config) return;

    const newPlatforms = [...config.platforms];
    newPlatforms[platformIndex].enabled = !newPlatforms[platformIndex].enabled;
    setConfig({ ...config, platforms: newPlatforms });
    notifyDirtyState(true);
  };



  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-green-500 border-t-transparent"></div>
          <p className="mt-3 text-gray-600 text-sm">加载配置中...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-pink-600">
          <p className="text-xl mb-2">⚠️</p>
          <p className="text-sm">加载配置失败</p>
        </div>
      </div>
    );
  }

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? '' : section);
  };

  return (
    <div className="px-4">
      {/* Message Toast */}
      {message && (
        <div className="fixed top-4 right-4 z-50 animate-fade-in">
          <div className={`px-4 py-3 rounded-lg shadow-2xl backdrop-blur-sm text-sm ${message.includes('✓')
            ? 'bg-green-500/90 text-white'
            : 'bg-red-500/90 text-white'
            }`}>
            <p className="font-medium">{message}</p>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        {/* ================ 平台配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('platforms')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center text-green-600 text-lg">
                🌐
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">数据平台配置</h2>
                <p className="text-xs text-gray-500">配置各个数据源平台的访问凭证</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'platforms' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'platforms' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {config.platforms.map((platform, index) => (
                  <div
                    key={platform.name}
                    className="group relative glass rounded-xl hover:shadow-lg transition-all duration-300 overflow-hidden border border-gray-200/50"
                  >
                    <div className="relative p-4">
                      {/* Platform Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700">
                            <PlatformIcon platform={platform.name} className="w-7 h-7" />
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-gray-800">{platform.name}</h3>
                            <p className="text-xs text-gray-500 mt-0.5">{platform.description}</p>
                          </div>
                        </div>

                        {/* Enable Toggle */}
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={platform.enabled}
                            onChange={() => togglePlatform(index)}
                            className="sr-only peer"
                            aria-label={`Enable ${platform.name}`}
                          />
                          <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[3px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                      </div>

                      {/* Status Badge */}
                      <div className="mb-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${platform.enabled && platform.has_token
                          ? 'bg-green-500/20 text-green-600 border border-green-500/30'
                          : 'bg-yellow-500/20 text-yellow-600 border border-yellow-500/30'
                          }`}>
                          {platform.enabled && platform.has_token ? '✓ 已配置' : '⚠ 未配置'}
                        </span>
                      </div>

                      {/* Expand/Collapse Button */}
                      <button
                        onClick={() => setExpandedPlatform(expandedPlatform === platform.name ? null : platform.name)}
                        className="w-full text-left flex items-center justify-between py-1.5 text-green-600 hover:text-pink-600 transition-colors text-sm font-medium"
                      >
                        <span>配置 {platform.name}</span>
                        <svg
                          className={`w-4 h-4 transition-transform ${expandedPlatform === platform.name ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Configuration Fields */}
                      {expandedPlatform === platform.name && (
                        <div className="mt-3 space-y-3 animate-fade-in">
                          {platform.config_fields.map((field) => (
                            <div key={field.key}>
                              <label htmlFor={`platform-${index}-${field.key}`} className="block text-xs font-medium text-gray-700 mb-1">
                                {field.label}
                                {field.required && <span className="text-pink-500 ml-1">*</span>}
                              </label>
                              <input
                                id={`platform-${index}-${field.key}`}
                                type={field.field_type}
                                value={field.value}
                                onChange={(e) => updateFieldValue(index, field.key, e.target.value)}
                                placeholder={field.placeholder}
                                className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                              />
                            </div>
                          ))}

                          {/* Test Button */}
                          <button
                            onClick={() => handleTest(platform.name)}
                            disabled={testing === platform.name}
                            className="w-full mt-3 px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white text-sm font-semibold rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-1.5"
                          >
                            {testing === platform.name ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
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
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ================ AI配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('ai')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center text-purple-600">
                <FaBrain className="w-6 h-6" />
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">AI 配置</h2>
                <p className="text-xs text-gray-500">配置AI模型和API密钥</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'ai' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'ai' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-white/50 rounded-lg border border-gray-200">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Provider: {config.ai_config.provider}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Model: {config.ai_config.model}</p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.ai_config.enabled
                    ? 'bg-green-500/20 text-green-600 border border-green-500/30'
                    : 'bg-red-500/20 text-red-600 border border-red-500/30'
                    }`}>
                    {config.ai_config.enabled ? '✓ 已配置' : '✗ 未配置'}
                  </span>
                </div>

                {/* AI Provider 选择器 */}
                {(() => {
                  const providerField = config.ai_config.config_fields.find(f => f.key === 'provider');
                  if (providerField) {
                    return (
                      <div key="provider">
                        <label htmlFor="ai-provider" className="block text-xs font-medium text-gray-700 mb-1">
                          {providerField.label}
                          {providerField.required && <span className="text-pink-500 ml-1">*</span>}
                        </label>
                        <select
                          id="ai-provider"
                          value={providerField.value}
                          onChange={(e) => updateAiFieldValue('provider', e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        >
                          <option value="gemini">Google Gemini</option>
                          <option value="openai">OpenAI Compatible</option>
                        </select>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* 根据 provider 显示对应的配置字段 */}
                {(() => {
                  const currentProvider = config.ai_config.config_fields.find(f => f.key === 'provider')?.value || 'gemini';
                  
                  return config.ai_config.config_fields
                    .filter(field => {
                      // 跳过 provider 字段(已经单独渲染)
                      if (field.key === 'provider') return false;
                      
                      // 根据当前 provider 过滤字段
                      if (currentProvider === 'gemini') {
                        return field.key.startsWith('gemini_');
                      } else if (currentProvider === 'openai') {
                        return field.key.startsWith('openai_');
                      }
                      return false;
                    })
                    .map((field) => (
                      <div key={field.key}>
                        <label htmlFor={`ai-${field.key}`} className="block text-xs font-medium text-gray-700 mb-1">
                          {field.label}
                          {field.required && <span className="text-pink-500 ml-1">*</span>}
                        </label>
                        <input
                          id={`ai-${field.key}`}
                          type={field.field_type}
                          value={field.value}
                          onChange={(e) => updateAiFieldValue(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        />
                      </div>
                    ));
                })()}
                
                {/* Provider 说明 */}
                <div className="mt-3 p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                  {config.ai_config.config_fields.find(f => f.key === 'provider')?.value === 'gemini' ? (
                    <>
                      <p className="text-xs font-semibold text-purple-900 mb-1">Google Gemini API</p>
                      <p className="text-xs text-purple-700">
                        获取 API Key: <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline font-medium">Google AI Studio</a><br/>
                        推荐模型: gemini-pro, gemini-1.5-flash, gemini-1.5-pro
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-blue-900 mb-1">OpenAI 兼容格式</p>
                      <p className="text-xs text-blue-700">
                        支持 OpenAI API 和其他兼容服务（如 Azure OpenAI, 第三方代理等）<br/>
                        Base URL: 官方为 https://api.openai.com/v1，自定义服务需要相应的端点地址<br/>
                        推荐模型: gpt-3.5-turbo, gpt-4, gpt-4-turbo
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ================ GitHub OAuth配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('oauth')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center text-white text-lg">
                🔐
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">GitHub OAuth 配置</h2>
                <p className="text-xs text-gray-500">配置 GitHub OAuth 应用以启用社交登录</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'oauth' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'oauth' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 mb-3">
                  <p className="text-xs text-blue-800">
                    💡 <strong>如何获取 GitHub OAuth 凭证：</strong><br/>
                    1. 访问 <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">GitHub Developer Settings</a><br/>
                    2. 点击 "New OAuth App" 创建新应用<br/>
                    3. 填写应用信息，Callback URL 填写：<code className="bg-white px-1 rounded">{API_URL}/api/auth/github/callback</code><br/>
                    4. 创建后复制 Client ID 和生成 Client Secret
                  </p>
                </div>

                <div>
                  <label htmlFor="github-client-id" className="block text-xs font-medium text-gray-700 mb-1">
                    GitHub Client ID
                    <span className="text-pink-500 ml-1">*</span>
                  </label>
                  <input
                    id="github-client-id"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_client_id')?.value || ''}
                    onChange={(e) => updateUiFieldValue('github_client_id', e.target.value)}
                    placeholder="GitHub OAuth App 的 Client ID"
                    className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="github-client-secret" className="block text-xs font-medium text-gray-700 mb-1">
                    GitHub Client Secret
                    <span className="text-pink-500 ml-1">*</span>
                  </label>
                  <input
                    id="github-client-secret"
                    type="password"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_client_secret')?.value || ''}
                    onChange={(e) => updateUiFieldValue('github_client_secret', e.target.value)}
                    placeholder="GitHub OAuth App 的 Client Secret"
                    className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="github-redirect-url" className="block text-xs font-medium text-gray-700 mb-1">
                    Redirect URL
                  </label>
                  <input
                    id="github-redirect-url"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'github_redirect_url')?.value || `${API_URL}/api/auth/github/callback`}
                    onChange={(e) => updateUiFieldValue('github_redirect_url', e.target.value)}
                    placeholder={`${API_URL}/api/auth/github/callback`}
                    className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all"
                  />
                  <p className="text-xs text-gray-500 mt-1">OAuth 回调地址，需与 GitHub App 设置中的一致</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ================ 报告配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('report')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-blue-600 text-lg">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">报告生成配置</h2>
                <p className="text-xs text-gray-500">设置报告话题风格和生成选项</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'report' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'report' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="space-y-3">
                {config.report_config.config_fields.map((field) => (
                  <div key={field.key}>
                    <label htmlFor={`report-${field.key}`} className="block text-xs font-medium text-gray-700 mb-1">
                      {field.label}
                      {field.required && <span className="text-pink-500 ml-1">*</span>}
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
                          className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        >
                          <option value="balanced">平衡 - 兼具深度与趣味</option>
                          <option value="playful">活泼 - 轻松有趣游戏化</option>
                          <option value="professional">专业 - 数据驱动严谨</option>
                          <option value="artistic">文艺 - 诗意隐喻感性</option>
                          <option value="experimental">实验 - 前卫大胆新奇</option>
                          <option value="custom">🎨 自定义风格...</option>
                        </select>
                        {field.value.startsWith('custom:') && (
                          <div className="mt-2">
                            <textarea
                              id={`report-${field.key}-custom`}
                              value={field.value.replace('custom:', '')}
                              onChange={(e) => updateReportFieldValue(field.key, `custom:${e.target.value}`)}
                              placeholder="例如：科幻未来风格，使用太空、AI、机器人等元素..."
                              rows={3}
                              className="w-full px-3 py-2 text-xs bg-white/50 border border-blue-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            />
                            <p className="text-xs text-blue-600 mt-1">
                              💡 详细描述你想要的话题风格，AI会根据描述生成个性化报告维度
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <input
                        id={`report-${field.key}`}
                        type={field.field_type}
                        value={field.value}
                        onChange={(e) => updateReportFieldValue(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 p-3 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg border border-blue-200">
                <p className="text-xs font-semibold text-blue-900 mb-1">报告话题风格说明：</p>
                <p className="text-xs text-blue-700">
                  每次生成报告时，AI会根据所选风格和你的实际数据，动态创建6个独特的分析维度。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ================ 虚拟人设配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('persona')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-100 to-pink-200 flex items-center justify-center text-purple-600 text-lg">
                🎭
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">虚拟人设配置</h2>
                <p className="text-xs text-gray-500">配置虚拟人设图片生成服务</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'persona' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'persona' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="space-y-4">
                {/* 启用开关 */}
                <div className="flex items-center justify-between p-3 bg-white/50 rounded-lg border border-gray-200">
                  <div>
                    <label className="text-sm font-medium text-gray-700">启用虚拟人设</label>
                    <p className="text-xs text-gray-500 mt-0.5">根据个人数据生成虚拟人物设定</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={config.persona_config.config_fields.find(f => f.key === 'persona_image_enabled')?.value === 'true'}
                      onChange={(e) => updatePersonaFieldValue('persona_image_enabled', e.target.checked.toString())}
                      aria-label="Enable Virtual Persona"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                  </label>
                </div>

                {/* 图片提供商选择 */}
                <div>
                  <label htmlFor="persona-provider" className="block text-xs font-medium text-gray-700 mb-2">
                    图片生成服务
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updatePersonaFieldValue('persona_image_provider', 'pollinations')}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'pollinations'
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 bg-white/50 hover:border-purple-300'
                      }`}
                    >
                      <div className="text-center">
                        <div className="text-xl mb-1">🆓</div>
                        <div className="text-sm font-semibold text-gray-800">Pollinations AI</div>
                        <div className="text-xs text-gray-500 mt-0.5">免费 · 快速</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => updatePersonaFieldValue('persona_image_provider', 'imaginepro')}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'imaginepro'
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 bg-white/50 hover:border-purple-300'
                      }`}
                    >
                      <div className="text-center">
                        <div className="text-xl mb-1">✨</div>
                        <div className="text-sm font-semibold text-gray-800">ImaginePro</div>
                        <div className="text-xs text-gray-500 mt-0.5">Midjourney · 高质量</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Pollinations 专属配置 */}
                {config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'pollinations' && (
                  <div className="space-y-3 p-3 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2 text-blue-700 text-xs font-semibold">
                      <span>🎨</span>
                      <span>Pollinations AI 配置</span>
                    </div>
                    
                    {/* 模型选择 */}
                    <div>
                      <label htmlFor="persona-model" className="block text-xs font-medium text-gray-700 mb-1">
                        AI 模型
                      </label>
                      <select
                        id="persona-model"
                        value={config.persona_config.config_fields.find(f => f.key === 'persona_image_model')?.value || 'flux-anime'}
                        onChange={(e) => updatePersonaFieldValue('persona_image_model', e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white/80 border border-blue-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      >
                        <option value="flux-anime">Flux Anime (推荐)</option>
                        <option value="flux">Flux (默认)</option>
                        <option value="flux-realism">Flux Realism (写实)</option>
                        <option value="flux-3d">Flux 3D (3D风格)</option>
                      </select>
                    </div>

                    {/* 图片尺寸 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="persona-width" className="block text-xs font-medium text-gray-700 mb-1">
                          宽度 (px)
                        </label>
                        <input
                          id="persona-width"
                          type="number"
                          min="256"
                          max="1024"
                          step="64"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_width')?.value || '512'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_width', e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white/80 border border-blue-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label htmlFor="persona-height" className="block text-xs font-medium text-gray-700 mb-1">
                          高度 (px)
                        </label>
                        <input
                          id="persona-height"
                          type="number"
                          min="256"
                          max="1024"
                          step="64"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_height')?.value || '768'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_height', e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white/80 border border-blue-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ImaginePro 专属配置 */}
                {config.persona_config.config_fields.find(f => f.key === 'persona_image_provider')?.value === 'imaginepro' && (
                  <div className="space-y-3 p-3 bg-gradient-to-br from-pink-50 to-purple-50 rounded-lg border border-pink-200">
                    <div className="flex items-center gap-2 text-pink-700 text-xs font-semibold">
                      <span>✨</span>
                      <span>ImaginePro (Midjourney) 配置</span>
                    </div>

                    {/* API Key */}
                    <div>
                      <label htmlFor="imaginepro-key" className="block text-xs font-medium text-gray-700 mb-1">
                        API Key <span className="text-pink-500">*</span>
                      </label>
                      <input
                        id="imaginepro-key"
                        type="password"
                        value={config.persona_config.config_fields.find(f => f.key === 'imaginepro_api_key')?.value || ''}
                        onChange={(e) => updatePersonaFieldValue('imaginepro_api_key', e.target.value)}
                        placeholder="从 imaginepro.ai 获取"
                        className="w-full px-3 py-2 text-sm bg-white/80 border border-pink-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 访问 <a href="https://imaginepro.ai" target="_blank" rel="noopener noreferrer" className="text-pink-600 hover:underline">imaginepro.ai</a> 注册并获取 API Key
                      </p>
                    </div>

                    {/* 图片尺寸 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="persona-width-mj" className="block text-xs font-medium text-gray-700 mb-1">
                          宽度 (px)
                        </label>
                        <input
                          id="persona-width-mj"
                          type="number"
                          min="512"
                          max="2048"
                          step="128"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_width')?.value || '1024'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_width', e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white/80 border border-pink-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label htmlFor="persona-height-mj" className="block text-xs font-medium text-gray-700 mb-1">
                          高度 (px)
                        </label>
                        <input
                          id="persona-height-mj"
                          type="number"
                          min="512"
                          max="2048"
                          step="128"
                          value={config.persona_config.config_fields.find(f => f.key === 'persona_image_height')?.value || '1536'}
                          onChange={(e) => updatePersonaFieldValue('persona_image_height', e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white/80 border border-pink-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>

                    {/* Webhook (可选) */}
                    <div>
                      <label htmlFor="imaginepro-callback" className="block text-xs font-medium text-gray-700 mb-1">
                        Webhook 回调地址 <span className="text-gray-400">(可选)</span>
                      </label>
                      <input
                        id="imaginepro-callback"
                        type="text"
                        value={config.persona_config.config_fields.find(f => f.key === 'imaginepro_callback_url')?.value || ''}
                        onChange={(e) => updatePersonaFieldValue('imaginepro_callback_url', e.target.value)}
                        placeholder="https://yourdomain.com/api/callback"
                        className="w-full px-3 py-2 text-sm bg-white/80 border border-pink-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        用于异步接收图片生成完成通知
                      </p>
                    </div>
                  </div>
                )}

                {/* 提示信息 */}
                <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
                  <p className="text-xs font-semibold text-purple-900 mb-1.5">💡 使用说明：</p>
                  <div className="text-xs text-purple-700 space-y-1">
                    <p>• <strong>Pollinations AI</strong>：完全免费，响应快速（&lt;1秒），适合开发测试和快速迭代</p>
                    <p>• <strong>ImaginePro</strong>：专业 Midjourney API，图片质量极高，适合生产环境（需付费订阅）</p>
                    <p>• AI 会根据你的数据生成独特的虚拟人设，点击首页右上角的圆形头像查看</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ================ UI配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('ui')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-100 to-indigo-200 flex items-center justify-center text-indigo-600 text-lg">
                🎨
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">UI 界面配置</h2>
                <p className="text-xs text-gray-500">自定义背景、主题等界面样式</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'ui' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'ui' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="space-y-3">
                {config.ui_config.config_fields
                  .filter((field) => !field.key.startsWith('pet_') && !field.key.startsWith('github_'))
                  .map((field) => (
                  <div key={field.key}>
                    <label htmlFor={`ui-${field.key}`} className="block text-xs font-medium text-gray-700 mb-1">
                      {field.label}
                      {field.required && <span className="text-pink-500 ml-1">*</span>}
                    </label>
                    <input
                      id={`ui-${field.key}`}
                      type={field.field_type}
                      value={field.value}
                      onChange={(e) => updateUiFieldValue(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      min={field.field_type === 'number' ? '0' : undefined}
                      max={field.field_type === 'number' ? '10' : undefined}
                      className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ================ 宠物吉祥物配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('pet')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center text-amber-600 text-xl">
                🐱
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">宠物吉祥物</h2>
                <p className="text-xs text-gray-500">可爱的行走角色</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'pet' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'pet' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="space-y-3">
                {/* 启用开关 */}
                <div className="flex items-center justify-between p-3 bg-white/50 rounded-lg border border-gray-200">
                  <div>
                    <label className="text-sm font-medium text-gray-700">启用宠物</label>
                    <p className="text-xs text-gray-500 mt-0.5">在报告信息卡上显示行走的宠物角色</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={config.ui_config.config_fields.find(f => f.key === 'pet_enabled')?.value === 'true'}
                      onChange={(e) => updateUiFieldValue('pet_enabled', e.target.checked.toString())}
                      aria-label="Enable Pet Mascot"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                  </label>
                </div>

                {/* 宠物图片 URL */}
                <div>
                  <label htmlFor="pet-image-url" className="block text-xs font-medium text-gray-700 mb-1">
                    宠物图片 URL
                  </label>
                  <input
                    id="pet-image-url"
                    type="text"
                    value={config.ui_config.config_fields.find(f => f.key === 'pet_image_url')?.value || ''}
                    onChange={(e) => updateUiFieldValue('pet_image_url', e.target.value)}
                    placeholder="宠物角色图片的URL"
                    className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  />
                </div>

                {/* 图片预览 */}
                {config.ui_config.config_fields.find(f => f.key === 'pet_image_url')?.value && (
                  <div className="p-3 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                    <p className="text-xs font-medium text-gray-700 mb-2">预览:</p>
                    <div className="flex items-end justify-center bg-white/50 rounded-lg p-4 min-h-[100px]">
                      <img
                        src={config.ui_config.config_fields.find(f => f.key === 'pet_image_url')?.value}
                        alt="Pet preview"
                        className="max-h-16 object-contain pixelated-image"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const errorMsg = e.currentTarget.parentElement?.querySelector('.error-msg');
                          if (errorMsg) errorMsg.classList.remove('hidden');
                        }}
                      />
                      <p className="error-msg hidden text-xs text-red-600">❌ 加载失败</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-xs text-amber-800">
                  🎮 宠物会在报告信息卡上随机行走，推荐使用带透明背景的像素风或可爱角色图片。点击宠物可触发特殊动画！
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default ConfigForm;
