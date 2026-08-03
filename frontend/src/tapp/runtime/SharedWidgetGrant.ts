/**
 * Re-exports for multi-widget shared Runtime Grant.
 * Implementation lives on TappRuntimeGrant to avoid circular imports.
 */

import { TappRuntimeGrant } from './TappRuntimeGrant'

export function acquireSharedWidgetGrant(tappId: string): {
  grant: TappRuntimeGrant
  release: () => void
} {
  return TappRuntimeGrant.acquireSharedWidget(tappId)
}

export function clearSharedWidgetGrants(): void {
  TappRuntimeGrant.clearSharedWidgetGrants()
}

export function sharedWidgetGrantRefCount(tappId: string): number {
  return TappRuntimeGrant.sharedWidgetRefCount(tappId)
}
