/** Observe one shell transition; interruption disposes it without reporting completion. */
export function watchPanelTransition(
  shell: HTMLElement | null,
  spatial: boolean,
  timeoutMs: number,
  complete: () => void,
): () => void {
  let done = false
  const dispose = () => {
    done = true
    clearTimeout(timer)
    shell?.removeEventListener('transitionend', onEnd)
  }
  const finish = () => {
    if (done) return
    dispose()
    complete()
  }
  const onEnd = (event: TransitionEvent) => {
    if (event.target === shell && event.propertyName === 'width') finish()
  }
  // Reduced spatial motion and background throttling still need a completion path.
  const timer = setTimeout(finish, timeoutMs)
  if (spatial) shell?.addEventListener('transitionend', onEnd)
  return dispose
}
