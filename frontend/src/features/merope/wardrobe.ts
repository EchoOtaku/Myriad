import type {
  ClothingStyle,
  OutfitVisual,
  UpperBodyVisualIdentity,
} from '../../components/agent/onboarding/onboardingTypes'
import {
  CLOTHING_STYLE_OPTIONS,
  clothingStyleFromProfile,
  parseUpperBodyVisualIdentity,
} from '../../components/agent/onboarding/onboardingTypes'

export const MAX_WARDROBE_ITEMS = 8

export interface WardrobeItem {
  id: string
  clothingStyle: ClothingStyle
  outfit: OutfitVisual
}

const LIVE_ID = 'live'

export function newWardrobeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `w-${crypto.randomUUID()}`
  }
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isClothingStyle(value: unknown): value is ClothingStyle {
  return (
    typeof value === 'string' &&
    (CLOTHING_STYLE_OPTIONS as string[]).includes(value)
  )
}

function parseOutfit(value: unknown): OutfitVisual | null {
  const parsed = parseUpperBodyVisualIdentity({
    character: {
      faceDesign: 'x',
      eyeDesign: 'x',
      hairShape: 'x',
      hairLayerPlan: 'x',
    },
    outfit: value,
  })
  return parsed?.outfit ?? null
}

export function parseWardrobeItem(value: unknown): WardrobeItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (!id || id.length > 64) return null
  if (!isClothingStyle(source.clothingStyle)) return null
  const outfit = parseOutfit(source.outfit)
  if (!outfit) return null
  return { id, clothingStyle: source.clothingStyle, outfit }
}

export function sortWardrobe(items: WardrobeItem[]): WardrobeItem[] {
  return [...items].sort((left, right) => {
    const byStyle =
      CLOTHING_STYLE_OPTIONS.indexOf(left.clothingStyle) -
      CLOTHING_STYLE_OPTIONS.indexOf(right.clothingStyle)
    if (byStyle !== 0) return byStyle
    return left.id.localeCompare(right.id)
  })
}

export function parseWardrobe(value: unknown): WardrobeItem[] {
  if (!Array.isArray(value)) return []
  const items: WardrobeItem[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const item = parseWardrobeItem(raw)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
    if (items.length >= MAX_WARDROBE_ITEMS) break
  }
  return items
}

export function applyOutfit(
  identity: UpperBodyVisualIdentity,
  item: WardrobeItem,
): UpperBodyVisualIdentity {
  return {
    character: identity.character,
    outfit: item.outfit,
  }
}

export function withPersistentIds(items: WardrobeItem[]): WardrobeItem[] {
  return items.map((item) =>
    item.id === LIVE_ID ? { ...item, id: newWardrobeId() } : item,
  )
}

export function persistWardrobeState(
  items: WardrobeItem[],
  activeId: string | null,
): { items: WardrobeItem[]; activeId: string | null } {
  const next = withPersistentIds(items)
  if (activeId !== LIVE_ID) return { items: next, activeId }
  const index = items.findIndex((item) => item.id === LIVE_ID)
  return {
    items: next,
    activeId: index >= 0 ? next[index].id : (next[0]?.id ?? null),
  }
}

export function syncActiveOutfit(
  items: WardrobeItem[],
  activeId: string | null,
  identity: UpperBodyVisualIdentity,
): WardrobeItem[] {
  if (!activeId) return items
  return items.map((item) =>
    item.id === activeId ? { ...item, outfit: identity.outfit } : item,
  )
}

function outfitsMatch(left: OutfitVisual, right: OutfitVisual): boolean {
  return (Object.keys(left) as Array<keyof OutfitVisual>).every(
    (key) => left[key] === right[key],
  )
}

export function hydrateWardrobe(
  profile: unknown,
  identity: UpperBodyVisualIdentity | null,
): { items: WardrobeItem[]; activeId: string | null } {
  const source =
    profile && typeof profile === 'object' && !Array.isArray(profile)
      ? (profile as Record<string, unknown>)
      : null
  const parsed = parseWardrobe(source?.wardrobe)
  const style = clothingStyleFromProfile(profile)
  if (parsed.length > 0) {
    const saved =
      typeof source?.activeOutfitId === 'string' ? source.activeOutfitId : null
    const matched =
      parsed.find((item) => item.id === saved) ??
      (identity && style
        ? parsed.find(
            (item) =>
              item.clothingStyle === style &&
              outfitsMatch(item.outfit, identity.outfit),
          )
        : undefined) ??
      parsed[0]
    return { items: parsed, activeId: matched.id }
  }
  if (!identity || !style) return { items: [], activeId: null }
  return {
    items: [
      {
        id: LIVE_ID,
        clothingStyle: style,
        outfit: identity.outfit,
      },
    ],
    activeId: LIVE_ID,
  }
}
