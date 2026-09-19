import { saveControlPanelLayout } from '../../../src/components/ControlPanel/widgetLayoutPersistence'
import { authSubject } from '../../../src/utils/authSubject'
import { getUIConfigDeduped } from '../../../src/utils/requestDedup'

const writes: Array<{ body: string, signal: AbortSignal, finish: () => void }> = []
let csrfPending: (() => void) | null = null
let holdCsrf = false
let reads = 0
const token = `v1.${'x'.repeat(16)}.${'y'.repeat(43)}`
window.fetch = async (input, options) => {
  const path = new URL(String(input), location.href).pathname
  if (path.endsWith('/csrf-token')) {
    if (holdCsrf) await new Promise<void>(resolve => { csrfPending = resolve })
    return Response.json({ csrf_token: token, expires_in: 3600 })
  }
  if (path.endsWith('/config/ui')) return Response.json({ revision: ++reads })
  if (path.endsWith('/config/control-panel')) { return new Promise<Response>((resolve, reject) => {
    const signal = options!.signal!
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    writes.push({ body: String(options!.body), signal, finish: () => resolve(Response.json({ success: true })) })
  })
}
  throw new Error(`Unexpected fixture request: ${path}`)
}
authSubject.change('fixture:admin')
Object.assign(window, { widgetSaveFixture: {
  save: (id: string) => {
    const layout = [{ id, type: 'weather', size: '2x2' as const, position: { x: 0, y: 0 } }]
    saveControlPanelLayout(layout, 2)
    layout[0].id = 'mutated after enqueue'
  },
  snapshot: () => ({ writes: writes.map(write => ({ body: write.body, aborted: write.signal.aborted })), reads, csrfWaiting: !!csrfPending }),
  finish: (index: number) => writes[index].finish(),
  changeSubject: () => authSubject.change('fixture:next-admin', true),
  holdCsrf: () => { holdCsrf = true },
  releaseCsrf: () => { holdCsrf = false; csrfPending?.(); csrfPending = null },
  read: () => getUIConfigDeduped(),
} })
