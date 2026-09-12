import type {
  PlatformConfig,
  ConfigField as PlatformConfigField,
} from './form/types'

function isMaskedValue(value: string) {
  return value.includes('••') || value.includes('**') || value === '********'
}

function hasFieldValue(field?: PlatformConfigField) {
  if (!field) return false
  const v = String(field.value ?? '').trim()
  return v.length > 0
}

function findField(platform: PlatformConfig, key: string) {
  return platform.config_fields.find((f) => f.key === key)
}

export function isBangumiPlatform(platform: PlatformConfig) {
  return platform.name.toLowerCase() === 'bangumi'
}

export function hasBangumiCredential(platform: PlatformConfig) {
  return (
    hasFieldValue(findField(platform, 'username')) ||
    hasFieldValue(findField(platform, 'access_token'))
  )
}

export function isPlatformConfigured(platform: PlatformConfig) {
  if (!platform.config_fields || platform.config_fields.length === 0) {
    return Boolean(platform.has_token)
  }

  const name = platform.name.trim().toLowerCase()

  if (isBangumiPlatform(platform)) {
    return hasBangumiCredential(platform)
  }

  if (name === 'discord') {
    return hasFieldValue(findField(platform, 'access_token'))
  }

  if (name === 'x' || name === 'twitter' || name === 'x (twitter)') {
    const userOk = hasFieldValue(findField(platform, 'username'))
    const tokenOk =
      hasFieldValue(findField(platform, 'bearer_token')) || platform.has_token
    return userOk && tokenOk
  }

  return platform.config_fields.every((field) => {
    if (!field.required) return true
    return hasFieldValue(field)
  })
}

export function sanitizeMaskedFieldValue(value: string): string {
  const trimmed = value.trimStart()
  // JSON 袋（服务商列表等）里会嵌套 •••• 掩码，不能当单个密码框清洗
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return value
  }
  if (isMaskedValue(value) && value !== '••••••••' && value !== '********') {
    return value.replaceAll(/[•*]+/g, '')
  }
  return value
}
