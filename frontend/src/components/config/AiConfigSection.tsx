import React from 'react';
import { useI18n } from '../../contexts/I18nContext';

interface ConfigField {
  key: string;
  label: string;
  field_type: string;
  value: string;
  placeholder: string;
  required: boolean;
}

interface AiConfig {
  provider: string;
  model: string;
  api_key: string;
  enabled: boolean;
  config_fields: ConfigField[];
}

interface AiConfigSectionProps {
  aiConfig: AiConfig;
  onUpdateField: (fieldKey: string, value: string) => void;
}

const AiConfigSection = React.memo<AiConfigSectionProps>(({ aiConfig, onUpdateField }) => {
  const { t } = useI18n();
  const providerField = aiConfig.config_fields.find(f => f.key === 'provider');
  const otherFields = aiConfig.config_fields.filter(f => f.key !== 'provider');

  return (
    <div className="config-section">
      <div className="section-header">
        <div className="section-header-left">
          <span className="section-icon icon-ai">🤖</span>
          <div>
            <h2 className="section-title">{t.config.ai}</h2>
            <p className="section-description">{t.config.aiDesc}</p>
          </div>
        </div>
      </div>

      <div className="config-form">
        {providerField && (
          <div className="form-group">
            <label className="form-label">
              {providerField.label}
              {providerField.required && <span className="required-mark">*</span>}
            </label>
            <div className="provider-selector">
              <button
                type="button"
                onClick={() => onUpdateField('provider', 'gemini')}
                className={`provider-option ${providerField.value === 'gemini' ? 'active' : ''}`}
              >
                <span className="provider-icon">🤖</span>
                <span className="provider-name">Google Gemini</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateField('provider', 'openai')}
                className={`provider-option ${providerField.value === 'openai' ? 'active' : ''}`}
              >
                <span className="provider-icon">🔥</span>
                <span className="provider-name">OpenAI</span>
              </button>
            </div>
          </div>
        )}

        {otherFields.map((field) => (
          <div key={field.key} className="form-group">
            <label className="form-label">
              {field.label}
              {field.required && <span className="required-mark">*</span>}
            </label>
            <input
              type={field.field_type === 'password' ? 'password' : 'text'}
              value={field.value}
              onChange={(e) => onUpdateField(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="form-input"
            />
          </div>
        ))}
      </div>
    </div>
  );
});

AiConfigSection.displayName = 'AiConfigSection';

export default AiConfigSection;
