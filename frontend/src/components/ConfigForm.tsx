import React, { useState, useEffect } from 'react';
import { API_URL } from '@config';
import PlatformIcon from './PlatformIcon';
import { FaBrain, FaClock } from 'react-icons/fa';

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

interface FetchConfig {
  auto_fetch: boolean;
  interval_hours: number;
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
  fetch_config: FetchConfig;
  ui_config: UiConfig;
}

const ConfigForm: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
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
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {field.label}
                          {field.required && <span className="text-pink-500 ml-1">*</span>}
                        </label>
                        <input
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {field.label}
                  {field.required && <span className="text-pink-500 ml-1">*</span>}
                </label>
                <input
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
              <p className="text-sm text-gray-600">Customize background wallpaper</p>
            </div>
          </div>

          <div className="space-y-4">
            {config.ui_config.config_fields.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {field.label}
                  {field.required && <span className="text-pink-500 ml-1">*</span>}
                </label>
                <input
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

        {/* Fetch Configuration Card */}
        <div className="glass rounded-2xl p-6 mb-8">
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-blue-600">
              <FaClock className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-800">Fetch Configuration</h3>
              <p className="text-sm text-gray-600">Automatic data synchronization</p>
            </div>
          </div>

          <div className="space-y-4">
            <label className="flex items-center cursor-pointer group">
              <input
                type="checkbox"
                checked={config.fetch_config.auto_fetch}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    fetch_config: { ...config.fetch_config, auto_fetch: e.target.checked },
                  });
                }}
                className="sr-only peer"
              />
              <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-500"></div>
              <span className="ml-3 text-gray-800 font-medium group-hover:text-green-600 transition-colors">
                Enable automatic fetching
              </span>
            </label>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fetch Interval (hours)
              </label>
              <input
                type="number"
                value={config.fetch_config.interval_hours}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    fetch_config: {
                      ...config.fetch_config,
                      interval_hours: parseInt(e.target.value) || 24,
                    },
                  });
                }}
                min="1"
                max="168"
                className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-2xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-8 py-4 bg-green-500 hover:bg-green-600 text-white font-bold text-lg rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
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
