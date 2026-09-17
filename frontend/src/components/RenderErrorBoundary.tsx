import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

export type RenderErrorFallback = (ctx: {
  error: Error | null
  reset: () => void
}) => ReactNode

interface RenderErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode | RenderErrorFallback
  /** Clear the failed state when this value changes (widget id, route, …). */
  resetKey?: unknown
  /** Console prefix so a log line names the surface that threw. */
  source?: string
  onError?: (error: Error, info: ErrorInfo) => void
}

interface RenderErrorBoundaryState {
  failed: boolean
  error: Error | null
  resetKey: unknown
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Isolate a render failure so one bad child cannot unmount the host tree.
 * Locale catalog failures stay on LocaleNamespaceBoundary; this one is for
 * programming errors (missing i18n keys, thrown components, …).
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = {
    failed: false,
    error: null,
    resetKey: this.props.resetKey,
  }

  static getDerivedStateFromError(
    error: unknown,
  ): Pick<RenderErrorBoundaryState, 'failed' | 'error'> {
    return { failed: true, error: asError(error) }
  }

  static getDerivedStateFromProps(
    props: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ): Pick<RenderErrorBoundaryState, 'failed' | 'error' | 'resetKey'> | null {
    if (props.resetKey === state.resetKey) return null
    return { failed: false, error: null, resetKey: props.resetKey }
  }

  reset = (): void => {
    this.setState({ failed: false, error: null })
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
    const tag = this.props.source ?? 'render'
    console.error(`[${tag}] render failed:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const { fallback } = this.props
    if (typeof fallback === 'function') {
      return fallback({ error: this.state.error, reset: this.reset })
    }
    return fallback ?? null
  }
}
