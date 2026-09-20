import { authSubject } from './authSubject'

export const HOST_SESSION_RECHECK_EVENT = 'host-session-recheck'

/**
 * A resource 401 may mean a runtime grant or upstream credential failed.
 * Ask the authoritative session endpoint before discarding the host identity.
 */
export function notifyHostSessionFailure(status: number, body: unknown, subject: AbortSignal): void {
  if (status !== 401 || subject.aborted || subject !== authSubject.signal) return
  if (body && typeof body === 'object' && (body as { code?: unknown }).code === 'INVALID_RUNTIME_GRANT') return
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HOST_SESSION_RECHECK_EVENT))
}
