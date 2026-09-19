import { trackPanelHeight } from '../../../src/components/ControlPanel/panelHeight'
import '../../../src/components/GlobalControlPanel.css'

let morphing = false
const notifications: string[] = []
window.addEventListener('control-panel-content-resize', () => {
  notifications.push(document.querySelector<HTMLElement>('.control-bar-trigger')!.style.height)
})
const shell = document.querySelector<HTMLElement>('.control-bar-trigger')!
const content = document.querySelector<HTMLElement>('.expanded-panel-content')!
const stop = trackPanelHeight(shell, content, () => morphing)
Object.assign(window, { panelHeightFixture: {
  morph: (active: boolean) => {
    morphing = active
    shell.classList.toggle('gcp-animating', active)
    if (!active) window.dispatchEvent(new Event('gcp-animation-end'))
  },
  stop,
  notifications: () => notifications.slice(),
} })
