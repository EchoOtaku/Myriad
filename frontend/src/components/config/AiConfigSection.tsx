/**
 * AI 配置区块
 * 使用通用设置组件重构
 */

import type { SettingOption } from '../settings/types'
import {
  FaMicrophone,
  FaVolumeUp,
  LuLeaf,
  LuPalette,
  LuSparkles,
  LuZap,
  SiGooglegemini,
  SiOpenai,
  SiOpenrouter,
} from '@lib/icons'
import React, { useCallback, useMemo, useState } from 'react'

import { useI18n } from '../../contexts/I18nContext'
import {
  ButtonItem,
  InputItem,
  ProviderItem,
  SelectItem,
  SettingGroup,
  SettingSection,
  SwitchItem,
  useSettingGuide,
} from '../settings'
import { AiProvidersQuickAccess } from './AiProvidersQuickAccess'

/**
 * Volcengine (火山引擎) 官方标识。
 * 路径与品牌色对齐公开品牌图标（lobe-icons / volcengine brand）。
 */
const VolcengineIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    aria-hidden
  >
    <title>Volcengine</title>
    <path
      d="M19.44 10.153l-2.936 11.586a.215.215 0 00.214.261h5.87a.215.215 0 00.214-.261l-2.95-11.586a.214.214 0 00-.412 0zM3.28 12.778l-2.275 8.96A.214.214 0 001.22 22h4.532a.212.212 0 00.214-.165.214.214 0 000-.097l-2.276-8.96a.214.214 0 00-.41 0z"
      fill="#00E5E5"
    />
    <path
      d="M7.29 5.359L3.148 21.738a.215.215 0 00.203.261h8.29a.214.214 0 00.215-.261L7.7 5.358a.214.214 0 00-.41 0z"
      fill="#006EFF"
    />
    <path
      d="M14.44.15a.214.214 0 00-.41 0L8.366 21.739a.214.214 0 00.214.261H19.9a.216.216 0 00.171-.078.214.214 0 00.044-.183L14.439.15z"
      fill="#006EFF"
    />
    <path
      d="M10.278 7.741L6.685 21.736a.214.214 0 00.214.264h7.17a.215.215 0 00.214-.264L10.688 7.741a.214.214 0 00-.41 0z"
      fill="#00E5E5"
    />
  </svg>
)

interface ConfigField {
  key: string
  label: string
  field_type: string
  value: string
  placeholder: string
  required: boolean
}

// OpenAI 兼容服务的 Base URL / 默认模型预设
const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
// OpenAI 官方 GPT-5.6 三档：Luna（快/省）· Terra（均衡）· Sol（旗舰）
const OPENAI_MODEL_LITE = 'gpt-5.6-luna'
const OPENAI_MODEL_STANDARD = 'gpt-5.6-terra'
const OPENAI_MODEL_PRO = 'gpt-5.6-sol'
// OpenRouter 默认模型：三个文本模型层级共用同一种 Provider 配置协议。
const OPENROUTER_MODEL_LITE = 'openai/gpt-oss-20b:free'
const OPENROUTER_MODEL_STANDARD = 'minimax/minimax-m3'
const OPENROUTER_MODEL_PRO = 'anthropic/claude-opus-5'

/**
 * 推断展示用的 Provider。
 * OpenRouter 是 OpenAI 兼容服务，后端仍以 provider=openai + openai_base_url 处理，
 * 因此这里根据 base_url 反推该高亮 OpenAI 还是 OpenRouter。
 */
function resolveProvider(rawProvider: string, openaiBaseUrl: string): string {
  if (
    rawProvider === 'openai' &&
    openaiBaseUrl.trim().toLowerCase().includes('openrouter.ai')
  ) {
    return 'openrouter'
  }
  return rawProvider
}

interface AiConfigSectionProps {
  /** AI 配置字段数组 */
  configFields: ConfigField[]
  /** 更新配置字段值 */
  updateValue: (key: string, value: string) => void
  /** ui bag：Agent 生命总开关存在这里，控件挂在 Lite 旁边 */
  uiConfigFields: Array<{ key: string; value: string }>
  updateUiFieldValue: (key: string, value: string) => void
  /** 语音测试回调 */
  onSpeechTest: () => Promise<{ success: boolean; message: string }>
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
}

interface ModelTierGroupProps {
  title: string
  icon: React.ReactNode
  description: React.ReactNode
  providerItemKey: string
  providerLabel: string
  provider: string
  providerOptions: SettingOption<string>[]
  providerHint?: string
  fields: ConfigField[]
  enabled?: boolean
  controls?: React.ReactNode
  onProviderChange: (provider: string) => void
  updateValue: (key: string, value: string) => void
}

const ModelTierGroup: React.FC<
  ModelTierGroupProps & {
    guide?: React.ReactNode
    guidePath?: string
    providerGuide?: React.ReactNode
    providerGuidePath?: string
    fieldGuideFor?: (
      fieldKey: string,
    ) => { guide?: React.ReactNode; guidePath?: string } | undefined
  }
> = ({
  title,
  icon,
  description,
  guide,
  guidePath,
  providerGuide,
  providerGuidePath,
  fieldGuideFor,
  providerItemKey,
  providerLabel,
  provider,
  providerOptions,
  providerHint,
  fields,
  enabled = true,
  controls,
  onProviderChange,
  updateValue,
}) => (
  <SettingGroup
    title={title}
    icon={icon}
    description={description}
    guide={guide}
    guidePath={guidePath}
  >
    {controls}
    {enabled && (
      <>
        <ProviderItem
          itemKey={providerItemKey}
          label={providerLabel}
          value={provider}
          onChange={onProviderChange}
          options={providerOptions}
          hint={providerHint}
          guide={providerGuide}
          guidePath={providerGuidePath}
          layout="horizontal"
        />
        {fields.map((field) => {
          const fieldGuide = fieldGuideFor?.(field.key)
          return (
            <InputItem
              key={field.key}
              itemKey={field.key}
              label={field.label}
              required={field.required}
              value={field.value}
              onChange={(value) => updateValue(field.key, value)}
              guide={fieldGuide?.guide}
              guidePath={fieldGuide?.guidePath}
              placeholder={field.placeholder}
              inputType={field.field_type as 'text' | 'password'}
              autoSelectOnMask
              layout="vertical"
            />
          )
        })}
      </>
    )}
  </SettingGroup>
)

function fieldsForModelTier(
  configFields: ConfigField[],
  prefix: '' | 'lite_' | 'pro_',
  provider: string,
): ConfigField[] {
  const providerKey = `${prefix}provider`
  const geminiPrefix = `${prefix}gemini_`
  const openaiPrefix = `${prefix}openai_`
  const openaiBaseUrlKey = `${prefix}openai_base_url`
  return configFields.filter((field) => {
    if (field.key === providerKey) return false
    if (provider === 'gemini') return field.key.startsWith(geminiPrefix)
    if (provider === 'openai' || provider === 'openrouter') {
      if (!field.key.startsWith(openaiPrefix)) return false
      return provider !== 'openrouter' || field.key !== openaiBaseUrlKey
    }
    return false
  })
}

export const AiConfigSection: React.FC<AiConfigSectionProps> = ({
  configFields,
  updateValue,
  uiConfigFields,
  updateUiFieldValue,
  onSpeechTest,
  title,
  icon,
  description,
  sectionId,
}) => {
  const { t } = useI18n()
  const { catalog: g, bindGuide } = useSettingGuide()
  const [speechTesting, setSpeechTesting] = useState(false)

  const fieldGuideFor = useCallback(
    (fieldKey: string) => {
      if (fieldKey.includes('api_key') || fieldKey.includes('secret')) {
        return bindGuide('ai.apiKey', g.ai.apiKey)
      }
      if (fieldKey.includes('base_url')) {
        return bindGuide('ai.baseUrl', g.ai.baseUrl)
      }
      if (fieldKey.includes('model')) {
        return bindGuide('ai.model', g.ai.model)
      }
      return bindGuide('ai.provider', g.ai.provider)
    },
    [g, bindGuide],
  )

  const providerGuideBinding = bindGuide('ai.provider', g.ai.provider)
  const [speechTestResult, setSpeechTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // 辅助函数：获取配置字段值
  const getFieldValue = useCallback(
    (key: string, defaultValue = '') => {
      return configFields.find((f) => f.key === key)?.value || defaultValue
    },
    [configFields],
  )

  // 当前 AI Provider (标准模型)。OpenRouter 依据 base_url 从 openai 中区分出来，未配置时默认 OpenRouter
  const currentProvider = useMemo(() => {
    const raw = getFieldValue('provider')
    if (!raw) return 'openrouter'
    return resolveProvider(raw, getFieldValue('openai_base_url'))
  }, [getFieldValue])

  // Lite 模型是否启用（关闭时回退 Standard）
  const liteEnabled = useMemo(() => {
    const val = getFieldValue('lite_enabled', 'false')
    return val === 'true' || val === '1'
  }, [getFieldValue])

  const agentLifeEnabled = useMemo(
    () =>
      uiConfigFields.find((field) => field.key === 'agent_life_enabled')
        ?.value === 'true',
    [uiConfigFields],
  )

  const currentLiteProvider = useMemo(() => {
    const raw = getFieldValue('lite_provider')
    if (!raw) return 'openrouter'
    return resolveProvider(raw, getFieldValue('lite_openai_base_url'))
  }, [getFieldValue])

  // Pro 模型是否启用（关闭时回退 Standard）
  const proEnabled = useMemo(() => {
    const val = getFieldValue('pro_enabled', 'false')
    return val === 'true' || val === '1'
  }, [getFieldValue])

  // 当前 Pro AI Provider（同样未配置时默认 OpenRouter）
  const currentProProvider = useMemo(() => {
    const raw = getFieldValue('pro_provider')
    if (!raw) return 'openrouter'
    return resolveProvider(raw, getFieldValue('pro_openai_base_url'))
  }, [getFieldValue])

  /**
   * 切换 Provider。OpenRouter 落到 provider=openai，并把对应的 base_url 与默认模型
   * 在 OpenAI 官方与 OpenRouter 之间切换（用户手填的自定义地址不覆盖）。
   */
  const handleProviderChange = useCallback(
    (
      providerKey: string,
      baseUrlKey: string,
      modelKey: string,
      openrouterModel: string,
      openaiModel: string,
      next: string,
    ) => {
      if (next === 'openrouter') {
        updateValue(providerKey, 'openai')
        updateValue(baseUrlKey, OPENROUTER_BASE_URL)
        updateValue(modelKey, openrouterModel)
        return
      }
      if (next === 'openai') {
        updateValue(providerKey, 'openai')
        const base = getFieldValue(baseUrlKey).trim().toLowerCase()
        // OpenRouter / 空地址 → 官方；自定义兼容端点保留 base（仍切换高亮与 provider）
        if (!base || base.includes('openrouter.ai')) {
          updateValue(baseUrlKey, OPENAI_BASE_URL)
          updateValue(modelKey, openaiModel)
        }
        return
      }
      // gemini 等：只改 provider；展示侧靠 resolveProvider
      updateValue(providerKey, next)
    },
    [getFieldValue, updateValue],
  )

  // 当前图片生成 Provider
  const currentImageProvider = useMemo(
    () => getFieldValue('ai_image_provider', 'openrouter'),
    [getFieldValue],
  )

  // 与上方 AI 设置共用同一套字段文案（优先后端 label，否则 i18n）
  const openaiFieldLabels = useMemo(() => {
    const byKey = (key: string, fallback: string) =>
      configFields.find((f) => f.key === key)?.label || fallback
    return {
      apiKey: byKey('openai_api_key', t.config.openaiApiKeyLabel),
      baseUrl: byKey('openai_base_url', t.config.openaiBaseUrlLabel),
      model: byKey('openai_model', t.config.openaiModelLabel),
    }
  }, [
    configFields,
    t.config.openaiApiKeyLabel,
    t.config.openaiBaseUrlLabel,
    t.config.openaiModelLabel,
  ])

  // AI Provider 选项。OpenRouter 默认在前，其次 OpenAI 兼容，最后 Gemini
  const aiProviderOptions: SettingOption<string>[] = useMemo(
    () => [
      {
        value: 'openrouter',
        label: t.config.providerOpenRouter,
        icon: <SiOpenrouter />,
      },
      { value: 'openai', label: t.config.openaiCompatible, icon: <SiOpenai /> },
      {
        value: 'gemini',
        label: t.config.providerGemini,
        icon: <SiGooglegemini />,
      },
    ],
    [
      t.config.openaiCompatible,
      t.config.providerGemini,
      t.config.providerOpenRouter,
    ],
  )

  // 图片生成 Provider 选项（OpenAI 兼容复用文本侧同名文案）
  const imageProviderOptions: SettingOption<string>[] = useMemo(
    () => [
      {
        value: 'openai',
        label: t.config.openaiCompatible,
        icon: <SiOpenai />,
        badge: t.config.imageProviderBadgeGptImage,
      },
      {
        value: 'openrouter',
        label: t.config.providerOpenRouter,
        icon: <SiOpenrouter />,
        badge: t.config.imageProviderBadgeImageApi,
      },
      {
        value: 'volcengine',
        label: t.config.providerVolcengine,
        icon: <VolcengineIcon />,
        badge: t.config.imageProviderBadgeSeedream,
      },
    ],
    [
      t.config.imageProviderBadgeGptImage,
      t.config.imageProviderBadgeImageApi,
      t.config.imageProviderBadgeSeedream,
      t.config.openaiCompatible,
      t.config.providerOpenRouter,
      t.config.providerVolcengine,
    ],
  )

  const handleImageProviderChange = useCallback(
    (provider: string) => {
      const defaults: Record<string, string> = {
        openai: 'gpt-image-2',
        openrouter: 'openai/gpt-image-2',
        volcengine: 'doubao-seedream-5-0-260128',
      }
      updateValue('ai_image_provider', provider)
      updateValue('ai_image_model', defaults[provider] ?? '')
    },
    [updateValue],
  )

  // 腾讯云区域选项
  const tencentRegionOptions: SettingOption<string>[] = useMemo(
    () => [
      { value: 'ap-guangzhou', label: t.config.tencentRegionGuangzhou },
      { value: 'ap-shanghai', label: t.config.tencentRegionShanghai },
      { value: 'ap-beijing', label: t.config.tencentRegionBeijing },
      { value: 'ap-chengdu', label: t.config.tencentRegionChengdu },
      { value: 'ap-chongqing', label: t.config.tencentRegionChongqing },
      { value: 'ap-nanjing', label: t.config.tencentRegionNanjing },
    ],
    [
      t.config.tencentRegionGuangzhou,
      t.config.tencentRegionShanghai,
      t.config.tencentRegionBeijing,
      t.config.tencentRegionChengdu,
      t.config.tencentRegionChongqing,
      t.config.tencentRegionNanjing,
    ],
  )

  const liteProviderFields = useMemo(
    () => fieldsForModelTier(configFields, 'lite_', currentLiteProvider),
    [configFields, currentLiteProvider],
  )
  const providerFields = useMemo(
    () => fieldsForModelTier(configFields, '', currentProvider),
    [configFields, currentProvider],
  )
  const proProviderFields = useMemo(
    () => fieldsForModelTier(configFields, 'pro_', currentProProvider),
    [configFields, currentProProvider],
  )

  // 处理语音测试
  const handleSpeechTest = useCallback(async () => {
    setSpeechTesting(true)
    setSpeechTestResult(null)
    try {
      const result = await onSpeechTest()
      setSpeechTestResult(result)
    } catch (error) {
      setSpeechTestResult({
        success: false,
        message:
          error instanceof Error ? error.message : t.config.speechTestFailed,
      })
    } finally {
      setSpeechTesting(false)
    }
  }, [onSpeechTest, t.config.speechTestFailed])

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
      // 仅 AI 配置页：完整 SettingTitleGuideEntry，夹在「重置」与「说明」之间
      headerBetweenPinned={<AiProvidersQuickAccess />}
    >
      <ModelTierGroup
        title={t.config.aiStandardModelTitle}
        icon={<LuSparkles />}
        description={t.config.aiStandardModelDesc}
        {...bindGuide('ai.standard', g.ai.standard)}
        providerGuide={providerGuideBinding.guide}
        providerGuidePath={providerGuideBinding.guidePath}
        fieldGuideFor={fieldGuideFor}
        providerItemKey="ai_provider"
        providerLabel={t.config.aiProvider}
        provider={currentProvider}
        providerOptions={aiProviderOptions}
        providerHint={t.config.aiProviderHint}
        fields={providerFields}
        onProviderChange={(provider) =>
          handleProviderChange(
            'provider',
            'openai_base_url',
            'openai_model',
            OPENROUTER_MODEL_STANDARD,
            OPENAI_MODEL_STANDARD,
            provider,
          )
        }
        updateValue={updateValue}
      />

      <ModelTierGroup
        title={t.config.aiLiteModelTitle}
        icon={<LuLeaf />}
        description={t.config.aiLiteModelDesc}
        {...bindGuide('ai.lite', g.ai.lite)}
        providerGuide={providerGuideBinding.guide}
        providerGuidePath={providerGuideBinding.guidePath}
        fieldGuideFor={fieldGuideFor}
        providerItemKey="lite_ai_provider"
        providerLabel={t.config.aiProvider}
        provider={currentLiteProvider}
        providerOptions={aiProviderOptions}
        providerHint={t.config.aiLiteProviderHint}
        fields={liteProviderFields}
        enabled={liteEnabled}
        controls={
          <SwitchItem
            itemKey="lite_enabled"
            label={t.config.aiLiteEnable}
            description={t.config.aiLiteEnableDesc}
            {...bindGuide('ai.liteEnable', g.ai.liteEnable)}
            value={liteEnabled}
            onChange={(value: boolean) =>
              updateValue('lite_enabled', value ? 'true' : 'false')
            }
            layout="horizontal"
          />
        }
        onProviderChange={(provider) =>
          handleProviderChange(
            'lite_provider',
            'lite_openai_base_url',
            'lite_openai_model',
            OPENROUTER_MODEL_LITE,
            OPENAI_MODEL_LITE,
            provider,
          )
        }
        updateValue={updateValue}
      />

      {/* 生命开口写的每一句都走 Lite，所以总开关紧跟在 Lite 后面：
          分到高级页的话，管理员会打开它、然后发现不生效。 */}
      <SettingGroup
        title={t.config.agentLife}
        description={t.config.agentLifeHint}
        {...bindGuide('ai.agentLife', g.ai.agentLife)}
        icon={<LuSparkles />}
      >
        <SwitchItem
          itemKey="agent_life_enabled"
          label={t.config.agentLife}
          description={t.config.agentLifeHint}
          value={agentLifeEnabled}
          onChange={(value: boolean) =>
            updateUiFieldValue('agent_life_enabled', value ? 'true' : 'false')
          }
          layout="horizontal"
        />
      </SettingGroup>

      <ModelTierGroup
        title={t.config.aiProModelTitle}
        icon={<LuZap />}
        description={t.config.aiProModelDesc}
        {...bindGuide('ai.pro', g.ai.pro)}
        providerGuide={providerGuideBinding.guide}
        providerGuidePath={providerGuideBinding.guidePath}
        fieldGuideFor={fieldGuideFor}
        providerItemKey="pro_ai_provider"
        providerLabel={t.config.aiProvider}
        provider={currentProProvider}
        providerOptions={aiProviderOptions}
        providerHint={t.config.aiProProviderHint}
        fields={proProviderFields}
        enabled={proEnabled}
        controls={
          <SwitchItem
            itemKey="pro_enabled"
            label={t.config.aiProEnable}
            description={t.config.aiProEnableDesc}
            {...bindGuide('ai.proEnable', g.ai.proEnable)}
            value={proEnabled}
            onChange={(value: boolean) =>
              updateValue('pro_enabled', value ? 'true' : 'false')
            }
            layout="horizontal"
          />
        }
        onProviderChange={(provider) =>
          handleProviderChange(
            'pro_provider',
            'pro_openai_base_url',
            'pro_openai_model',
            OPENROUTER_MODEL_PRO,
            OPENAI_MODEL_PRO,
            provider,
          )
        }
        updateValue={updateValue}
      />

      {/* 图片生成模型 */}
      <SettingGroup
        title={t.config.aiImageTitle}
        icon={<LuPalette />}
        description={t.config.aiImageDesc}
        {...bindGuide('ai.image', g.ai.image)}
      >
        <ProviderItem
          itemKey="image_provider"
          label={t.config.aiProvider}
          {...bindGuide('ai.provider', g.ai.provider)}
          value={currentImageProvider}
          onChange={handleImageProviderChange}
          options={imageProviderOptions}
          layout="horizontal"
        />

        {currentImageProvider === 'openai' && (
          <>
            <InputItem
              itemKey="ai_image_openai_api_key"
              label={openaiFieldLabels.apiKey}
              required
              value={getFieldValue('ai_image_openai_api_key')}
              onChange={(v) => updateValue('ai_image_openai_api_key', v)}
              placeholder="sk-..."
              inputType="password"
              autoSelectOnMask
              {...bindGuide('ai.apiKey', g.ai.apiKey)}
              layout="vertical"
            />
            <InputItem
              itemKey="ai_image_openai_base_url"
              label={openaiFieldLabels.baseUrl}
              value={getFieldValue(
                'ai_image_openai_base_url',
                OPENAI_BASE_URL,
              )}
              onChange={(v) => updateValue('ai_image_openai_base_url', v)}
              placeholder={OPENAI_BASE_URL}
              inputType="text"
              {...bindGuide('ai.baseUrl', g.ai.baseUrl)}
              layout="vertical"
            />
          </>
        )}

        {currentImageProvider === 'openrouter' && (
          <InputItem
            itemKey="ai_image_openrouter_api_key"
            label={openaiFieldLabels.apiKey}
            required
            value={getFieldValue('ai_image_openrouter_api_key')}
            onChange={(v) => updateValue('ai_image_openrouter_api_key', v)}
            placeholder="sk-or-v1-..."
            inputType="password"
            autoSelectOnMask
            {...bindGuide('ai.apiKey', g.ai.apiKey)}
            layout="vertical"
          />
        )}

        {currentImageProvider === 'volcengine' && (
          <>
            <InputItem
              itemKey="ai_image_volcengine_api_key"
              label={t.config.volcengineArkApiKey}
              required
              value={getFieldValue('ai_image_volcengine_api_key')}
              onChange={(v) => updateValue('ai_image_volcengine_api_key', v)}
              placeholder={t.config.volcengineArkApiKeyPlaceholder}
              inputType="password"
              autoSelectOnMask
              {...bindGuide('ai.apiKey', g.ai.apiKey)}
              layout="vertical"
            />
            <InputItem
              itemKey="ai_image_volcengine_base_url"
              label={t.config.volcengineArkBaseUrl}
              value={getFieldValue(
                'ai_image_volcengine_base_url',
                'https://ark.cn-beijing.volces.com/api/v3',
              )}
              onChange={(v) => updateValue('ai_image_volcengine_base_url', v)}
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
              inputType="text"
              {...bindGuide('ai.baseUrl', g.ai.baseUrl)}
              layout="vertical"
            />
          </>
        )}

        <InputItem
          itemKey="ai_image_model"
          label={openaiFieldLabels.model}
          value={getFieldValue('ai_image_model', 'openai/gpt-image-2')}
          onChange={(v) => updateValue('ai_image_model', v)}
          placeholder={
            currentImageProvider === 'openai'
              ? 'gpt-image-2'
              : currentImageProvider === 'volcengine'
                ? 'doubao-seedream-5-0-260128'
                : 'openai/gpt-image-2'
          }
          inputType="text"
          layout="vertical"
        />
      </SettingGroup>

      {/* 语音服务配置 */}
      <SettingGroup
        title={t.config.speechServiceTitle}
        icon={<FaMicrophone />}
        description={t.config.speechServiceDesc}
        {...bindGuide('ai.speech', g.ai.speech)}
      >
        <InputItem
          itemKey="tencent_secret_id"
          label={t.config.tencentSecretId}
          value={getFieldValue('tencent_secret_id')}
          onChange={(v) => updateValue('tencent_secret_id', v)}
          placeholder={t.config.tencentSecretIdPlaceholder}
          inputType="password"
          autoSelectOnMask
          layout="vertical"
        />

        <InputItem
          itemKey="tencent_secret_key"
          label={t.config.tencentSecretKey}
          value={getFieldValue('tencent_secret_key')}
          onChange={(v) => updateValue('tencent_secret_key', v)}
          placeholder={t.config.tencentSecretKeyPlaceholder}
          inputType="password"
          autoSelectOnMask
          layout="vertical"
        />

        <SelectItem
          itemKey="tencent_region"
          label={t.config.tencentRegion}
          value={getFieldValue('tencent_region', 'ap-guangzhou')}
          onChange={(v) => updateValue('tencent_region', v)}
          options={tencentRegionOptions}
          layout="vertical"
        />

        <ButtonItem
          itemKey="speech_test"
          label=""
          buttonText={t.config.speechTestAvailability}
          buttonIcon={<FaVolumeUp />}
          onClick={handleSpeechTest}
          loading={speechTesting}
          result={speechTestResult}
          variant="secondary"
          layout="vertical"
        />
      </SettingGroup>
    </SettingSection>
  )
}

export default AiConfigSection
