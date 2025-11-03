import React, { useState, useEffect } from 'react';
import { API_URL } from '@/config';
import PlatformIcon from './PlatformIcon';
import { FaBrain } from 'react-icons/fa';

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
  ui_config: UiConfig;
}

const ConfigForm: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState('');
  const [message, setMessage] = useState('');
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string>('platforms'); // 默认展开平台配置

  // 使用 useCallback 包装处理函数，避免闭包问题
  const handleSave = React.useCallback(async () => {
    if (!config) {
      console.error('No config to save');
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
    console.log('Saving config...', config);

    try {
      const response = await fetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      console.log('Save response status:', response.status);
      const result = await response.json();
      console.log('Save result:', result);

      if (response.ok) {
        setMessage('✓ 配置已保存！请重启后端生效。');
        notifyDirtyState(false);
        window.dispatchEvent(
          new CustomEvent('config-save-result', {
            detail: {
              success: true,
              message: result.message || '配置已保存',
            },
          })
        );
        setTimeout(() => setMessage(''), 5000);
      } else {
        const errorMsg = `✗ 保存失败: ${result.message || 'Unknown error'}`;
        setMessage(errorMsg);
        window.dispatchEvent(
          new CustomEvent('config-save-result', {
            detail: {
              success: false,
              message: result.message || '保存失败',
            },
          })
        );
      }
    } catch (error) {
      console.error('Save config error:', error);
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
    console.log('Resetting config to defaults (clearing all values)...');
    setMessage('正在重置配置...');
    
    try {
      // 加载配置结构
      const response = await fetch(`${API_URL}/api/config`);
      const data = await response.json();
      console.log('Loaded config structure:', data);
      
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
        ui_config: {
          ...data.ui_config,
          config_fields: data.ui_config.config_fields.map((field: any) => {
            // 保留UI配置的默认值
            let defaultValue = '';
            if (field.key === 'wallpaper_url') {
              defaultValue = 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809';
            } else if (field.key === 'wallpaper_blur') {
              defaultValue = '3';
            } else if (field.key === 'image_gen_enabled' || field.key === 'pet_enabled') {
              defaultValue = 'true';
            } else if (field.key === 'image_gen_model') {
              defaultValue = 'flux';
            } else if (field.key === 'image_gen_width' || field.key === 'image_gen_height') {
              defaultValue = '512';
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
      
      console.log('Cleared config:', clearedData);
      setConfig(clearedData);
      notifyDirtyState(false);
      
      // 等待一小段时间确保状态更新
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 自动保存
      setMessage('正在保存默认配置...');
      console.log('Saving cleared config...');
      
      const saveResponse = await fetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clearedData),
      });

      const saveResult = await saveResponse.json();
      console.log('Save result:', saveResult);

      if (saveResponse.ok) {
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
      } else {
        throw new Error(saveResult.message || '保存失败');
      }
    } catch (error) {
      console.error('Reset config error:', error);
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
      const response = await fetch(`${API_URL}/api/profile/fetch-all`, {
        method: 'POST',
      });

      const result = await response.json();

      if (result.success || response.ok) {
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
              message: '平台数据刷新成功',
            },
          })
        );
      } else {
        setMessage(`✗ 刷新失败: ${result.message || 'Unknown error'}`);
        window.dispatchEvent(
          new CustomEvent('platform-data-refresh-result', {
            detail: {
              success: false,
              message: result.message || '刷新失败',
            },
          })
        );
      }
    } catch (error) {
      setMessage('✗ 刷新平台数据失败');
      console.error(error);
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
      console.log('Received request-config-save event');
      handleSave();
    };
    const handleResetEvent = () => {
      console.log('Received config-reset event');
      handleReset();
    };
    const handleRefreshEvent = () => {
      console.log('Received request-platform-refresh event');
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
      const response = await fetch(`${API_URL}/api/config`);
      const data = await response.json();
      setConfig(data);
      notifyDirtyState(false);
      
      // 触发配置加载完成事件，传递配置数据
      const event = new CustomEvent('config-loaded', { detail: data });
      window.dispatchEvent(event);
    } catch (error) {
      setMessage('Failed to load configuration');
      console.error(error);
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

      const response = await fetch(`${API_URL}/api/config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: platformName,
          config: configObj,
        }),
      });

      const result = await response.json();
      setMessage(result.message);
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      setMessage('✗ 连接测试失败');
      console.error(error);
    } finally {
      setTesting(null);
    }
  };

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
    if (!config) return;

    const newFields = [...config.ai_config.config_fields];
    const field = newFields.find(f => f.key === fieldKey);
    if (field) {
      field.value = value;
      setConfig({
        ...config,
        ai_config: { ...config.ai_config, config_fields: newFields }
      });
      notifyDirtyState(true);
    }
  };

  const updateReportFieldValue = (fieldKey: string, value: string) => {
    if (!config) return;

    const newFields = [...config.report_config.config_fields];
    const field = newFields.find(f => f.key === fieldKey);
    if (field) {
      field.value = value;
      setConfig({
        ...config,
        report_config: { ...config.report_config, config_fields: newFields }
      });
      notifyDirtyState(true);
    }
  };

  const updateUiFieldValue = (fieldKey: string, value: string) => {
    if (!config) return;

    const newFields = [...config.ui_config.config_fields];
    const field = newFields.find(f => f.key === fieldKey);
    if (field) {
      field.value = value;
      setConfig({
        ...config,
        ui_config: { ...config.ui_config, config_fields: newFields }
      });
      notifyDirtyState(true);
    }
  };

  const togglePlatform = (platformIndex: number) => {
    if (!config) return;

    const newPlatforms = [...config.platforms];
    newPlatforms[platformIndex].enabled = !newPlatforms[platformIndex].enabled;
    setConfig({ ...config, platforms: newPlatforms });
    notifyDirtyState(true);
  };

  const handleGenerateIllustrations = async () => {
    setGenerating(true);
    setMessage('');
    setGenerateProgress('正在加载报告...');

    try {
      const reportResponse = await fetch(`${API_URL}/api/profile/report`);
      if (!reportResponse.ok) {
        throw new Error('未找到报告，请先生成报告');
      }

      const reportData = await reportResponse.json();
      if (!reportData.report || !reportData.report.cards || reportData.report.cards.length === 0) {
        throw new Error('报告中没有卡片，请先生成报告');
      }

      const cards = reportData.report.cards;
      const totalCards = cards.length;
      
      setGenerateProgress(`正在为 ${totalCards} 张卡片生成插图...`);

      const { generateCardIllustration } = await import('../utils/imageGenerator');

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        setGenerateProgress(`正在生成插图 ${i + 1}/${totalCards}: ${card.title}`);

        await generateCardIllustration(
          card.topic_id,
          card.title,
          card.content.summary,
          card.category
        );
      }

      setMessage('✓ 所有插图生成完成！刷新页面查看效果。');
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '生成失败';
      setMessage(`✗ ${errorMsg}`);
      console.error('Generate illustrations error:', error);
    } finally {
      setGenerating(false);
      setGenerateProgress('');
    }
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

                {config.ai_config.config_fields.map((field) => (
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
                ))}
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
                📊
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
                <p className="text-xs font-semibold text-blue-900 mb-1">📊 报告话题风格说明：</p>
                <p className="text-xs text-blue-700">
                  每次生成报告时，AI会根据所选风格和你的实际数据，动态创建6个独特的分析维度。
                </p>
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
                  .filter((field) => !field.key.startsWith('image_gen_') && !field.key.startsWith('pet_'))
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

        {/* ================ AI图片生成配置分类 ================ */}
        <div className="glass rounded-xl mb-5 overflow-hidden">
          <button
            onClick={() => toggleSection('image')}
            className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-100 to-pink-200 flex items-center justify-center text-pink-600 text-lg">
                🖼️
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-800">AI 图片生成</h2>
                <p className="text-xs text-gray-500">为卡片生成插图</p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${expandedSection === 'image' ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'image' && (
            <div className="p-4 border-t border-gray-200/50 animate-fade-in">
              <div className="space-y-3">
                {/* 启用开关 */}
                <div className="flex items-center justify-between p-3 bg-white/50 rounded-lg border border-gray-200">
                  <div>
                    <label className="text-sm font-medium text-gray-700">启用AI插图</label>
                    <p className="text-xs text-gray-500 mt-0.5">自动为报告卡片生成插图</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={config.ui_config.config_fields.find(f => f.key === 'image_gen_enabled')?.value === 'true'}
                      onChange={(e) => updateUiFieldValue('image_gen_enabled', e.target.checked.toString())}
                      aria-label="Enable AI Illustrations"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-pink-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                  </label>
                </div>

                {/* 模型选择 */}
                <div>
                  <label htmlFor="image-gen-model" className="block text-xs font-medium text-gray-700 mb-1">
                    AI 模型
                  </label>
                  <select
                    id="image-gen-model"
                    value={config.ui_config.config_fields.find(f => f.key === 'image_gen_model')?.value || 'flux'}
                    onChange={(e) => updateUiFieldValue('image_gen_model', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                  >
                    <option value="flux">Flux (Default)</option>
                    <option value="flux-realism">Flux Realism</option>
                    <option value="flux-anime">Flux Anime</option>
                    <option value="flux-3d">Flux 3D</option>
                    <option value="turbo">Turbo</option>
                  </select>
                </div>

                {/* 图片尺寸 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="image-width" className="block text-xs font-medium text-gray-700 mb-1">
                      宽度 (px)
                    </label>
                    <input
                      id="image-width"
                      type="number"
                      min="256"
                      max="1024"
                      step="64"
                      value={config.ui_config.config_fields.find(f => f.key === 'image_gen_width')?.value || '512'}
                      onChange={(e) => updateUiFieldValue('image_gen_width', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label htmlFor="image-height" className="block text-xs font-medium text-gray-700 mb-1">
                      高度 (px)
                    </label>
                    <input
                      id="image-height"
                      type="number"
                      min="256"
                      max="1024"
                      step="64"
                      value={config.ui_config.config_fields.find(f => f.key === 'image_gen_height')?.value || '512'}
                      onChange={(e) => updateUiFieldValue('image_gen_height', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white/50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {/* 生成按钮 */}
                <div className="mt-4 border-t border-gray-200 pt-4">
                  <button
                    onClick={handleGenerateIllustrations}
                    disabled={generating}
                    className="w-full px-6 py-3 text-white font-semibold rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center space-x-2 btn-primary-large text-sm"
                  >
                    {generating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        <span>{generateProgress}</span>
                      </>
                    ) : (
                      <>
                        <span>🎨</span>
                        <span>为所有卡片生成插图</span>
                      </>
                    )}
                  </button>
                  <p className="text-xs text-gray-500 text-center mt-2">
                    需要先生成报告后才能生成插图
                  </p>
                </div>
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
