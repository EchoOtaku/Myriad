import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

interface WidgetErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  /** Reset the failed state when this value changes (widget id, route, …). */
  resetKey?: unknown
  onError?: (error: Error, info: ErrorInfo) => void
}

interface WidgetErrorBoundaryState {
  failed: boolean
  resetKey: unknown
}

/**
 * Isolate a render failure so one bad widget/page cannot unmount the whole app.
 * The host otherwise has no boundary between a widget and the root, so a single
 * throwing component white-screens the homepage.
 */
export class WidgetErrorBoundary extends Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = {
    failed: false,
    resetKey: this.props.resetKey,
  }

  static getDerivedStateFromError(): Pick<WidgetErrorBoundaryState, 'failed'> {
    return { failed: true }
  }

  static getDerivedStateFromProps(
    props: WidgetErrorBoundaryProps,
    state: WidgetErrorBoundaryState,
  ): Pick<WidgetErrorBoundaryState, 'failed' | 'resetKey'> | null {
    if (props.resetKey === state.resetKey) return null
    return { failed: false, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
    console.error('[widget] render failed:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}

export default WidgetErrorBoundary
