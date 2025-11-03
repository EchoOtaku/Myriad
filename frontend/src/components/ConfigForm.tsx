import React, { useState, useEffect } from 'react';
import { API_URL } from '@config';
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
  ui_config: UiConfig;
}

const ConfigForm: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState('');
  const [message, setMessage] = useState('');
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API_URL}/api/config`);
      const data = await response.json();
      setConfig(data);
    } catch (error) {
      setMessage('Failed to load configuration');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    setMessage('');

    try {
      const response = await fetch(`${API_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const result = await response.json();

      if (response.ok) {
        setMessage('✓ Configuration saved! Please restart backend to apply changes.');
        setTimeout(() => setMessage(''), 5000);
      } else {
        setMessage(`✗ Failed to save: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      setMessage('✗ Failed to save configuration');
      console.error(error);
    } finally {
      setSaving(false);
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
      setMessage('✗ Connection test failed');
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
    }
  };

  const togglePlatform = (platformIndex: number) => {
    if (!config) return;

    const newPlatforms = [...config.platforms];
    newPlatforms[platformIndex].enabled = !newPlatforms[platformIndex].enabled;
    setConfig({ ...config, platforms: newPlatforms });
  };

  const handleGenerateIllustrations = async () => {
    setGenerating(true);
    setMessage('');
    setGenerateProgress('正在加载报告...');

    try {
      // 1. 获取当前报告
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

      // 2. 动态导入 imageGenerator
      const { generateCardIllustration } = await import('../utils/imageGenerator');

      // 3. 依次为每张卡片生成插图
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
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent"></div>
          <p className="mt-4 text-gray-600">Loading configuration...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-pink-600">
          <p className="text-2xl mb-4">⚠️</p>
          <p>Failed to load configuration</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      {/* Message Toast */}
      {message && (
        <div className="fixed top-4 right-4 z-50 animate-fade-in">
          <div className={`px-6 py-4 rounded-lg shadow-2xl backdrop-blur-sm ${message.includes('✓')
            ? 'bg-green-500/90 text-white'
            : 'bg-red-500/90 text-white'
            }`}>
            <p className="font-medium">{message}</p>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4 text-gray-800">
            Platform Configuration
          </h1>
          <p className="text-gray-600 text-lg">Connect and manage your integrations</p>
        </div>

        {/* Platform Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {config.platforms.map((platform, index) => (
            <div
              key={platform.name}
              className="group relative glass rounded-2xl hover:shadow-xl transition-all duration-300 overflow-hidden"
            >

              <div className="relative p-6">
                {/* Platform Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700">
                      <PlatformIcon platform={platform.name} className="w-10 h-10" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-800">{platform.name}</h3>
                      <p className="text-sm text-gray-600 mt-1">{platform.description}</p>
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
                    <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-500"></div>
                  </label>
                </div>

                {/* Status Badge */}
                <div className="mb-4">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${platform.enabled && platform.has_token
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    }`}>
                    {platform.enabled && platform.has_token ? '✓ Connected' : '⚠ Not Configured'}
                  </span>
                </div>

                {/* Expand/Collapse Button */}
                <button
                  onClick={() => setExpandedPlatform(expandedPlatform === platform.name ? null : platform.name)}
                  className="w-full text-left flex items-center justify-between py-2 text-green-600 hover:text-pink-600 transition-colors"
                >
                  <span className="font-medium">Configure {platform.name}</span>
                  <svg
                    className={`w-5 h-5 transition-transform ${expandedPlatform === platform.name ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Configuration Fields */}
                {expandedPlatform === platform.name && (
                  <div className="mt-4 space-y-4 animate-fade-in">
                    {platform.config_fields.map((field) => (
                      <div key={field.key}>
                        <label htmlFor={`platform-${index}-${field.key}`} className="block text-sm font-medium text-gray-700 mb-2">
                          {field.label}
                          {field.required && <span className="text-pink-500 ml-1">*</span>}
                        </label>
                        <input
                          id={`platform-${index}-${field.key}`}
                          type={field.field_type}
                          value={field.value}
                          onChange={(e) => updateFieldValue(index, field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-2xl text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                        />
                      </div>
                    ))}

                    {/* Test Button */}
                    <button
                      onClick={() => handleTest(platform.name)}
                      disabled={testing === platform.name}
                      className="w-full mt-4 px-6 py-3 bg-pink-500 hover:bg-pink-600 text-white font-semibold rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      {testing === platform.name ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <span>🔍</span>
                          <span>Test Connection</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* AI Configuration Card */}
        <div className="glass rounded-2xl p-6 mb-8">
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center text-purple-600">
              <FaBrain className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-800">AI Configuration</h3>
              <p className="text-sm text-gray-600">Powered by {config.ai_config.provider}</p>
            </div>
          </div>

          <div className="space-y-4">
            {config.ai_config.config_fields.map((field) => (
              <div key={field.key}>
                <label htmlFor={`ai-${field.key}`} className="block text-sm font-medium text-gray-700 mb-2">
                  {field.label}
                  {field.required && <span className="text-pink-500 ml-1">*</span>}
                </label>
                <input
                  id={`ai-${field.key}`}
                  type={field.field_type}
                  value={field.value}
                  onChange={(e) => updateAiFieldValue(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-2xl text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.ai_config.enabled
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
              {config.ai_config.enabled ? '✓ API Key Configured' : '✗ API Key Not Configured'}
            </span>
          </div>
        </div>

        {/* UI Configuration Card */}
        <div className="glass rounded-2xl p-6 mb-8">
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-indigo-200 flex items-center justify-center text-indigo-600">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-800">UI Configuration</h3>
              <p className="text-sm text-gray-600">Customize background &amp; illustrations</p>
            </div>
          </div>

          <div className="space-y-4">
            {config.ui_config.config_fields
              .filter((field) => !field.key.startsWith('image_gen_')) // 过滤掉 AI 图片生成字段
              .map((field) => (
              <div key={field.key}>
                <label htmlFor={`ui-${field.key}`} className="block text-sm font-medium text-gray-700 mb-2">
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
                  className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-2xl text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
            <p className="text-sm text-blue-800">
              💡 <strong>Tip:</strong> You can use Unsplash URLs (e.g., https://source.unsplash.com/1920x1080/?nature)
              or any image URL. Changes apply after saving and reloading the page.
            </p>
          </div>
        </div>

        {/* AI Image Generation Card */}
        <div className="glass rounded-2xl p-6 mb-8">
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-100 to-pink-200 flex items-center justify-center text-pink-600">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-800">AI Image Generation</h3>
              <p className="text-sm text-gray-600">Generate card illustrations with Pollinations AI</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* 启用/禁用开关 */}
            <div className="flex items-center justify-between p-4 bg-white/50 rounded-2xl border border-gray-200">
              <div>
                <label className="text-sm font-medium text-gray-700">Enable AI Illustrations</label>
                <p className="text-xs text-gray-500 mt-1">Automatically generate Ghibli-style illustrations for report cards</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={config.ui_config.config_fields.find(f => f.key === 'image_gen_enabled')?.value === 'true'}
                  onChange={(e) => updateUiFieldValue('image_gen_enabled', e.target.checked.toString())}
                  aria-label="Enable AI Illustrations"
                />
                <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-pink-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-pink-500"></div>
              </label>
            </div>

            {/* 模型选择 */}
            <div>
              <label htmlFor="image-gen-model" className="block text-sm font-medium text-gray-700 mb-2">
                AI Model <span className="text-pink-500 ml-1">*</span>
              </label>
              <select
                id="image-gen-model"
                value={config.ui_config.config_fields.find(f => f.key === 'image_gen_model')?.value || 'flux'}
                onChange={(e) => updateUiFieldValue('image_gen_model', e.target.value)}
                className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-2xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
              >
                <option value="flux">Flux (Default) - Balanced quality</option>
                <option value="flux-realism">Flux Realism - Photorealistic</option>
                <option value="flux-anime">Flux Anime - Anime style</option>
                <option value="flux-3d">Flux 3D - 3D rendering</option>
                <option value="turbo">Turbo - Fast generation</option>
              </select>
            </div>

            {/* 图片尺寸 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="image-width" className="block text-sm font-medium text-gray-700 mb-2">
                  Width (px)
                </label>
                <input
                  id="image-width"
                  type="number"
                  min="256"
                  max="1024"
                  step="64"
                  value={config.ui_config.config_fields.find(f => f.key === 'image_gen_width')?.value || '512'}
                  onChange={(e) => updateUiFieldValue('image_gen_width', e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-2xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label htmlFor="image-height" className="block text-sm font-medium text-gray-700 mb-2">
                  Height (px)
                </label>
                <input
                  id="image-height"
                  type="number"
                  min="256"
                  max="1024"
                  step="64"
                  value={config.ui_config.config_fields.find(f => f.key === 'image_gen_height')?.value || '512'}
                  onChange={(e) => updateUiFieldValue('image_gen_height', e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-2xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 p-4 bg-pink-50 rounded-xl border border-pink-200">
            <p className="text-sm text-pink-800">
              🎨 <strong>Style:</strong> Generated illustrations feature transparent backgrounds with a single main subject (person or object) in Studio Ghibli watercolor style. Perfect for card decorations!
            </p>
          </div>
          
          {/* 生成插图按钮 */}
          <div className="mt-6 border-t border-gray-200 pt-6">
            <button
              onClick={handleGenerateIllustrations}
              disabled={generating}
              className="w-full px-8 py-4 text-white font-bold text-lg rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex items-center justify-center space-x-3 btn-primary-large"
            >
              {generating ? (
                <>
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
                  <span>{generateProgress}</span>
                </>
              ) : (
                <>
                  <span>🎨</span>
                  <span>为所有卡片生成插图</span>
                </>
              )}
            </button>
            <p className="text-sm text-gray-500 text-center mt-3">
              点击后将为当前报告的所有卡片生成 AI 插图（需要先生成报告）
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-8 py-4 text-white font-bold text-lg rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed btn-secondary-large"
          >
            {saving ? '💾 Saving...' : '💾 Save All Changes'}
          </button>
          <button
            onClick={loadConfig}
            className="px-8 py-4 glass hover:bg-white/90 text-gray-800 font-bold text-lg rounded-2xl transition-all duration-300"
          >
            🔄 Reset
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigForm;
