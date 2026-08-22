import { ApiError } from '../../../services/api'

const HOST_GENERATION_CODES = new Set([
  'report_dna_failed',
  'pro_unavailable',
  'name_suggest_failed',
  'persona_draft_failed',
  'visual_design_failed',
  'visual_design_language',
  'visual_design_required',
  'visual_identity_invalid',
  'persona_contract_invalid',
  'portrait_generation_in_progress',
  'character_visual_inputs_changed',
  'image_provider_unconfigured',
  'portrait_generation_failed',
  'portrait_edit_notes_required',
  'portrait_required_for_edit',
])

export function errorCode(reason: unknown): string | undefined {
  if (reason instanceof ApiError && reason.code) return reason.code
  if (
    reason &&
    typeof reason === 'object' &&
    'code' in reason &&
    typeof (reason as { code: unknown }).code === 'string'
  ) {
    return (reason as { code: string }).code
  }
  return undefined
}

export function isGenerationTimeout(reason: unknown): boolean {
  if (reason instanceof ApiError && reason.code === 'TIMEOUT') return true
  const message = reason instanceof Error ? reason.message : String(reason ?? '')
  return /timeout/i.test(message)
}

export function isPortraitInProgress(reason: unknown): boolean {
  return errorCode(reason) === 'portrait_generation_in_progress'
}

export function generationFailureMessage(
  reason: unknown,
  fallback: string,
  timeoutMessage: string,
  byCode?: Record<string, string>,
): string {
  if (isGenerationTimeout(reason)) return timeoutMessage
  const code = errorCode(reason)
  if (code && byCode?.[code]) return byCode[code]
  if (code && HOST_GENERATION_CODES.has(code)) return fallback
  if (reason instanceof Error && reason.message.trim()) return reason.message
  return fallback
}
