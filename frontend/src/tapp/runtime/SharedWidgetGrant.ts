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
  // destroyAll already clears the share table; this is for targeted tests.
  // Re-acquire path after destroyAll starts empty.
}

export function sharedWidgetGrantRefCount(tappId: string): number {
  return TappRuntimeGrant.sharedWidgetRefCount(tappId)
}
