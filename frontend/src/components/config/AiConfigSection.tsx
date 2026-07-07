/**
 * AI 配置区块
 * 使用通用设置组件重构
 */

import type { SettingOption } from '../settings/types'
import {
  FaFreeCodeCamp,
  FaMagic,
  FaMicrophone,
  FaVolumeUp,
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
  CompactSettingGroup,
  InputItem,
  NumberItem,
  ProviderItem,
  SelectItem,
  SettingGroup,
  SettingSection,
  SwitchItem,
} from '../settings'

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
const OPENAI_MODEL = 'gpt-5.5'
// OpenRouter 默认模型：标准层级用 MiniMax M3，Pro 层级用 Opus 4.8
const OPENROUTER_MODEL_STANDARD = 'minimax/minimax-m3'
const OPENROUTER_MODEL_PRO = 'anthropic/claude-opus-4.8'

/**
 * 推断展示用的 Provider。
 * OpenRouter 是 OpenAI 兼容服务，后端仍以 provider=openai + openai_base_url 处理，
 * 因此这里根据 base_url 反推该高亮 OpenAI 还是 OpenRouter。
 */
const resolveProvider = (rawProvider: string, openaiBaseUrl: string): string => {
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
  /** 语音测试回调 */
  onSpeechTest: () => Promise<{ success: boolean; message: string }>
  title: string
  icon: React.ReactNode
  description: string
  sectionId?: string
}

export const AiConfigSection: React.FC<AiConfigSectionProps> = ({
  configFields,
  updateValue,
  onSpeechTest,
  title,
  icon,
  description,
  sectionId,
}) => {
  const { t } = useI18n()
  const [speechTesting, setSpeechTesting] = useState(false)
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

  // Pro 模型是否启用
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
      next: string,
    ) => {
      if (next === 'openrouter') {
        updateValue(providerKey, 'openai')
        updateValue(baseUrlKey, OPENROUTER_BASE_URL)
        updateValue(modelKey, openrouterModel)
      } else if (next === 'openai') {
        updateValue(providerKey, 'openai')
        // 从 OpenRouter 切回时重置为官方地址与默认模型
        if (getFieldValue(baseUrlKey).toLowerCase().includes('openrouter.ai')) {
          updateValue(baseUrlKey, OPENAI_BASE_URL)
          updateValue(modelKey, OPENAI_MODEL)
        }
      } else {
        updateValue(providerKey, next)
      }
    },
    [getFieldValue, updateValue],
  )

  // 当前图片生成 Provider
  const currentImageProvider = useMemo(
    () => getFieldValue('ai_image_provider', 'pollinations'),
    [getFieldValue],
  )

  // AI Provider 选项。OpenRouter 默认在前，其次 OpenAI 兼容，最后 Gemini
  const aiProviderOptions: SettingOption<string>[] = useMemo(
    () => [
      { value: 'openrouter', label: 'OpenRouter', icon: <SiOpenrouter /> },
      { value: 'openai', label: t.config.openaiCompatible, icon: <SiOpenai /> },
      { value: 'gemini', label: 'Gemini', icon: <SiGooglegemini /> },
    ],
    [t.config.openaiCompatible],
  )

  // 图片生成 Provider 选项
  const imageProviderOptions: SettingOption<string>[] = useMemo(
    () => [
      {
        value: 'pollinations',
        label: 'Pollinations',
        icon: <FaFreeCodeCamp />,
        badge: t.config.pollinationsFree,
      },
      { value: 'pixai', label: 'PixAI', icon: <FaMagic />, badge: 'SD/DiT' },
    ],
    [t.config.pollinationsFree],
  )

  // Pollinations 模型选项
  const pollinationsModelOptions: SettingOption<string>[] = useMemo(
    () => [
      { value: 'flux-anime', label: t.config.fluxAnimeRecommend },
      { value: 'flux', label: t.config.fluxDefault },
      { value: 'flux-realism', label: t.config.fluxRealism },
      { value: 'flux-3d', label: t.config.flux3D },
    ],
    [
      t.config.fluxAnimeRecommend,
      t.config.fluxDefault,
      t.config.fluxRealism,
      t.config.flux3D,
    ],
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

  // Standard Provider 对应的配置字段
  const providerFields = useMemo(() => {
    return configFields.filter((field) => {
      if (field.key === 'provider') return false
      if (field.key.startsWith('pro_')) return false
      if (field.key.startsWith('ai_image_') || field.key.startsWith('pixai_'))
        return false
      if (field.key.startsWith('tencent_')) return false

      if (currentProvider === 'gemini') {
        return field.key.startsWith('gemini_')
      } else if (currentProvider === 'openai' || currentProvider === 'openrouter') {
        // OpenRouter 复用 OpenAI 兼容字段，但 Base URL 固定无需展示
        if (!field.key.startsWith('openai_')) return false
        if (currentProvider === 'openrouter' && field.key === 'openai_base_url')
          return false
        return true
      }
      return false
    })
  }, [configFields, currentProvider])

  // Pro Provider 对应的配置字段
  const proProviderFields = useMemo(() => {
    return configFields.filter((field) => {
      if (field.key === 'pro_provider') return false
      if (!field.key.startsWith('pro_')) return false

      if (currentProProvider === 'gemini') {
        return field.key.startsWith('pro_gemini_')
      } else if (
        currentProProvider === 'openai' ||
        currentProProvider === 'openrouter'
      ) {
        // OpenRouter 复用 OpenAI 兼容字段，但 Base URL 固定无需展示
        if (!field.key.startsWith('pro_openai_')) return false
        if (
          currentProProvider === 'openrouter' &&
          field.key === 'pro_openai_base_url'
        )
          return false
        return true
      }
      return false
    })
  }, [configFields, currentProProvider])

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
        message: error instanceof Error ? error.message : 'Test failed',
      })
    } finally {
      setSpeechTesting(false)
    }
  }, [onSpeechTest])

  return (
    <SettingSection
      title={title}
      icon={icon}
      description={description}
      sectionId={sectionId}
    >
      {/* 标准模型 AI 服务 */}
      <SettingGroup
        title={t.config.aiStandardModelTitle}
        icon={<LuSparkles />}
        description={
          <>
            {t.config.aiStandardModelDesc}
            {' · '}
            Gemini {t.config.geminiDescription}{' '}
            <a
              href="https://makersuite.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.config.getApiKey}
            </a>
            {' · '}
            {t.config.openaiCompatible}：{t.config.openaiDescription}
          </>
        }
      >
        {/* AI Provider 选择 */}
        <ProviderItem
          itemKey="ai_provider"
          label={t.config.aiProvider}
          value={currentProvider}
          onChange={(v) =>
            handleProviderChange(
              'provider',
              'openai_base_url',
              'openai_model',
              OPENROUTER_MODEL_STANDARD,
              v,
            )
          }
          options={aiProviderOptions}
          hint={t.config.aiProviderHint}
          layout="horizontal"
        />

        {/* Provider 配置字段 */}
        {providerFields.map((field) => (
          <InputItem
            key={field.key}
            itemKey={field.key}
            label={field.label}
            required={field.required}
            value={field.value}
            onChange={(v) => updateValue(field.key, v)}
            placeholder={field.placeholder}
            inputType={field.field_type as 'text' | 'password'}
            autoSelectOnMask
            layout="vertical"
          />
        ))}
      </SettingGroup>

      {/* Pro 模型 AI 服务 */}
      <SettingGroup
        title={t.config.aiProModelTitle}
        icon={<LuZap />}
        description={t.config.aiProModelDesc}
      >
        {/* Pro 模型开关 */}
        <SwitchItem
          itemKey="pro_enabled"
          label={t.config.aiProEnable}
          description={t.config.aiProEnableDesc}
          value={proEnabled}
          onChange={(v: boolean) =>
            updateValue('pro_enabled', v ? 'true' : 'false')
          }
          layout="horizontal"
        />

        {proEnabled && (
          <>
            {/* Pro AI Provider 选择 */}
            <ProviderItem
              itemKey="pro_ai_provider"
              label={t.config.aiProvider}
              value={currentProProvider}
              onChange={(v) =>
                handleProviderChange(
                  'pro_provider',
                  'pro_openai_base_url',
                  'pro_openai_model',
                  OPENROUTER_MODEL_PRO,
                  v,
                )
              }
              options={aiProviderOptions}
              hint={t.config.aiProProviderHint}
              layout="horizontal"
            />

            {/* Pro Provider 配置字段 */}
            {proProviderFields.map((field) => (
              <InputItem
                key={field.key}
                itemKey={field.key}
                label={field.label}
                required={field.required}
                value={field.value}
                onChange={(v) => updateValue(field.key, v)}
                placeholder={field.placeholder}
                inputType={field.field_type as 'text' | 'password'}
                autoSelectOnMask
                layout="vertical"
              />
            ))}
          </>
        )}
      </SettingGroup>

      {/* AI 图片生成配置 */}
      <SettingGroup
        title={t.config.aiImageTitle}
        icon={<LuPalette />}
        description={t.config.aiImageDesc}
      >
        {/* 图片生成 Provider 选择 */}
        <ProviderItem
          itemKey="image_provider"
          label={t.config.imageGenService}
          value={currentImageProvider}
          onChange={(v) => updateValue('ai_image_provider', v)}
          options={imageProviderOptions}
          layout="horizontal"
        />

        {/* Pollinations 配置 */}
        {currentImageProvider === 'pollinations' && (
          <>
            <SelectItem
              itemKey="ai_image_model"
              label={t.config.aiModel}
              value={getFieldValue('ai_image_model', 'flux-anime')}
              onChange={(v) => updateValue('ai_image_model', v)}
              options={pollinationsModelOptions}
              layout="vertical"
            />
            <CompactSettingGroup>
              <NumberItem
                itemKey="ai_image_width_poll"
                label={t.config.width}
                value={Number.parseInt(
                  getFieldValue('ai_image_width', '512'),
                  10,
                )}
                onChange={(v) => updateValue('ai_image_width', String(v))}
                min={256}
                max={1024}
                step={64}
                layout="vertical"
              />
              <NumberItem
                itemKey="ai_image_height_poll"
                label={t.config.height}
                value={Number.parseInt(
                  getFieldValue('ai_image_height', '768'),
                  10,
                )}
                onChange={(v) => updateValue('ai_image_height', String(v))}
                min={256}
                max={1024}
                step={64}
                layout="vertical"
              />
            </CompactSettingGroup>
          </>
        )}

        {/* PixAI 配置 */}
        {currentImageProvider === 'pixai' && (
          <>
            <InputItem
              itemKey="pixai_api_key"
              label="API Key"
              required
              value={getFieldValue('pixai_api_key')}
              onChange={(v) => updateValue('pixai_api_key', v)}
              placeholder={t.config.pixaiPlaceholder}
              inputType="password"
              autoSelectOnMask
              layout="vertical"
            />
            <InputItem
              itemKey="ai_image_model_pixai"
              label={t.config.pixaiModelId}
              value={getFieldValue('ai_image_model', '1983308862240288769')}
              onChange={(v) => updateValue('ai_image_model', v)}
              placeholder="1983308862240288769"
              inputType="text"
              layout="vertical"
            />
            <CompactSettingGroup>
              <NumberItem
                itemKey="ai_image_width_pixai"
                label={t.config.width}
                value={Number.parseInt(
                  getFieldValue('ai_image_width', '768'),
                  10,
                )}
                onChange={(v) => updateValue('ai_image_width', String(v))}
                min={768}
                max={1280}
                step={128}
                layout="vertical"
              />
              <NumberItem
                itemKey="ai_image_height_pixai"
                label={t.config.height}
                value={Number.parseInt(
                  getFieldValue('ai_image_height', '1280'),
                  10,
                )}
                onChange={(v) => updateValue('ai_image_height', String(v))}
                min={768}
                max={1280}
                step={128}
                layout="vertical"
              />
            </CompactSettingGroup>
          </>
        )}
      </SettingGroup>

      {/* 语音服务配置 */}
      <SettingGroup
        title={t.config.speechServiceTitle}
        icon={<FaMicrophone />}
        description={t.config.speechServiceDesc}
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
          loadingText={t.config.speechTestTesting}
          result={speechTestResult}
          variant="secondary"
          layout="vertical"
        />
      </SettingGroup>
    </SettingSection>
  )
}

export default AiConfigSection
