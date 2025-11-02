import React, { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '@lib/api';

interface PlatformConfig {
  name: string;
  enabled: boolean;
  has_token: boolean;
}

interface AiConfig {
  provider: string;
  model: string;
  enabled: boolean;
}

interface FetchConfig {
  auto_fetch: boolean;
  interval_hours: number;
}

interface Config {
  platforms: PlatformConfig[];
  ai_config: AiConfig;
  fetch_config: FetchConfig;
}

const ConfigForm: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await fetchConfig();
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
      await updateConfig(config);
      setMessage('Configuration saved successfully!');
    } catch (error) {
      setMessage('Failed to save configuration');
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading configuration...</div>;
  }

  if (!config) {
    return <div className="text-center py-8 text-red-600">Failed to load configuration</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      {message && (
        <div
          className={`mb-4 p-4 rounded-lg ${message.includes('success')
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
            }`}
        >
          {message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Platform Configuration</h2>
        <div className="space-y-4">
          {config.platforms.map((platform, index) => (
            <div key={platform.name} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <div className="font-semibold">{platform.name}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Token: {platform.has_token ? '✓ Configured' : '✗ Not configured'}
                </div>
              </div>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={platform.enabled}
                  onChange={(e) => {
                    const newPlatforms = [...config.platforms];
                    newPlatforms[index].enabled = e.target.checked;
                    setConfig({ ...config, platforms: newPlatforms });
                  }}
                  className="w-5 h-5 text-primary-600 rounded focus:ring-2 focus:ring-primary-500"
                />
                <span className="ml-2">Enabled</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">AI Configuration</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Provider</label>
            <input
              type="text"
              value={config.ai_config.provider}
              readOnly
              className="w-full px-4 py-2 border rounded-lg bg-gray-50 dark:bg-gray-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Model</label>
            <input
              type="text"
              value={config.ai_config.model}
              readOnly
              className="w-full px-4 py-2 border rounded-lg bg-gray-50 dark:bg-gray-700"
            />
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Status: {config.ai_config.enabled ? '✓ API Key configured' : '✗ API Key not configured'}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Fetch Configuration</h2>
        <div className="space-y-4">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.fetch_config.auto_fetch}
              onChange={(e) => {
                setConfig({
                  ...config,
                  fetch_config: { ...config.fetch_config, auto_fetch: e.target.checked },
                });
              }}
              className="w-5 h-5 text-primary-600 rounded focus:ring-2 focus:ring-primary-500"
            />
            <span className="ml-2">Enable automatic fetching</span>
          </label>
          <div>
            <label className="block text-sm font-medium mb-2">Fetch Interval (hours)</label>
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
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700"
              min="1"
              max="168"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-primary-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        <button
          onClick={loadConfig}
          className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          Reset
        </button>
      </div>
    </div>
  );
};

export default ConfigForm;
