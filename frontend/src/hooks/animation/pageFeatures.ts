export enum Feature {
  Visibility = 1 << 0,
  Resize = 1 << 1,
  Intersection = 1 << 2,
}

/** 只列 hasFeature 还在读的位。 */
export const PAGE_FEATURES: Record<string, number> = {
  home: Feature.Visibility | Feature.Resize,
  library: Feature.Intersection,
}

export function hasFeature(pageId: string, feature: Feature): boolean {
  const features = PAGE_FEATURES[pageId] ?? 0
  return (features & feature) !== 0
}
