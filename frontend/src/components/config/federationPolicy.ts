import type {
  TrustPolicyResponse,
  UpdateTrustPolicyRequest,
} from '../../types/federation'

/** owned by ConfigForm save */
export interface FederationPolicyDraft {
  minTrust: number
  allowlistText: string
  autoDiscover: boolean
  rateMax: number
  rateWindow: number
  rateTrustedMul: number
}

export const DEFAULT_FEDERATION_POLICY: FederationPolicyDraft = {
  minTrust: 0,
  allowlistText: '',
  autoDiscover: true,
  rateMax: 100,
  rateWindow: 60,
  rateTrustedMul: 5,
}

export function federationPolicyFromApi(
  p: TrustPolicyResponse,
): FederationPolicyDraft {
  return {
    minTrust: p.min_trust_level ?? 0,
    allowlistText: (p.allowed_domains || []).join('\n'),
    autoDiscover: p.auto_discover !== false,
    rateMax: p.rate_limit?.max_requests_per_window ?? 100,
    rateWindow: p.rate_limit?.window_seconds ?? 60,
    rateTrustedMul: p.rate_limit?.trusted_multiplier ?? 5,
  }
}

export function areFederationPoliciesEqual(
  a: FederationPolicyDraft,
  b: FederationPolicyDraft,
): boolean {
  return (
    a.minTrust === b.minTrust &&
    a.allowlistText === b.allowlistText &&
    a.autoDiscover === b.autoDiscover &&
    a.rateMax === b.rateMax &&
    a.rateWindow === b.rateWindow &&
    a.rateTrustedMul === b.rateTrustedMul
  )
}

export function federationPolicyToUpdateRequest(
  draft: FederationPolicyDraft,
): UpdateTrustPolicyRequest {
  const domains = draft.allowlistText
    .split(/[\n,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return {
    min_trust_level: draft.minTrust,
    allowed_domains: domains,
    auto_discover: draft.autoDiscover,
    rate_limit: {
      max_requests_per_window: draft.rateMax,
      window_seconds: draft.rateWindow,
      trusted_multiplier: draft.rateTrustedMul,
    },
  }
}
