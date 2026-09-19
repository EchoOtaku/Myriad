import React, { useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimationPreferenceProvider } from '../../../src/contexts/AnimationPreferenceContext'
import {
  MusicPlayerProvider,
  useMusicPlayerControl,
} from '../../../src/contexts/MusicPlayerContext'
import { coordinator } from '../../../src/hooks/animation/coordinator'
import { now, observeResize as observeResizeAtomic, scheduleTask } from '../../../src/hooks/animation/core'
import { useWidgetResizeObserver } from '../../../src/hooks/animation/useWidgetResizeObserver'
import { useEvocativeWallpaper } from '../../../src/hooks/useEvocativeWallpaper'
import { useWidgetSize } from '../../../src/hooks/useWidgetSize'
import { useIframeResize } from '../../../src/tapp/utils/iframeResize'
import { sharedEventManager } from '../../../src/utils/sharedEventManager'

function WidgetSizeProbe() {
  const { containerRef, width, height } = useWidgetSize('2x2')
  const { observeWidgetResize, unobserveWidgetResize } = useWidgetResizeObserver()
  const observerNode = useRef<HTMLDivElement | null>(null)
  const [observedWidths, setObservedWidths] = useState<number[]>([])
  const observerRef = useCallback((node: HTMLDivElement | null) => {
    if (observerNode.current) unobserveWidgetResize(observerNode.current)
    observerNode.current = node
    if (node) observeWidgetResize(node, entry => setObservedWidths(prev => [...prev, entry.contentRect.width]))
  }, [observeWidgetResize, unobserveWidgetResize])
  const widths = useRef<number[]>([])
  if (width > 0 && widths.current.at(-1) !== width) widths.current.push(width)
  return <div id="widget-transform" style={{ transform: 'scale(0.9)' }}>
    <div ref={containerRef} id="widget-size-container" style={{ width: 300, height: 200 }} />
    <div ref={observerRef} style={{ width: 300, height: 200 }} />
    <output id="home-observed-widths">{JSON.stringify(observedWidths)}</output>
    <output id="widget-size" data-widths={JSON.stringify(widths.current)}>{width}:{height}</output>
  </div>
}

function Wallpaper({ fps }: { fps: number }) {
  useEvocativeWallpaper('perf-wallpaper', {
    fps,
    parallax: { enabled: true, enableGyroscope: false },
    dynamicBlur: { enabled: false },
    ripple: { enabled: false },
  })
  return <div id="perf-wallpaper" style={{ width: 300, height: 200 }} />
}

function Ripple() {
  useEvocativeWallpaper('wallpaper', {
    parallax: { enabled: false, enableGyroscope: false },
    dynamicBlur: { enabled: false },
    ripple: { enabled: true },
    rippleQuality: 0.85,
  })
  return <div id="bg-container" style={{ position: 'fixed', inset: 0 }}>
    <div id="wallpaper" style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/icons/greeting/sunrise.webp)', backgroundSize: 'cover' }} />
  </div>
}

function IframeSize() {
  const { containerRef, dimensions } = useIframeResize()
  return <>
    <div ref={containerRef} id="iframe-size-container" style={{ width: 151, height: 200 }} />
    <output id="iframe-size">{dimensions.width}:{String(dimensions.isCompact)}:{String(dimensions.isMini)}</output>
  </>
}

let renders = 0

function MusicConsumer() {
  const state = useMusicPlayerControl()
  renders++
  return <output id="music">{String(state.isPlaying)}:{state.currentLyricIndex}</output>
}

createRoot(document.getElementById('root')!).render(
  <MusicPlayerProvider><MusicConsumer /></MusicPlayerProvider>,
)

Object.assign(window, {
  performanceFixture: {
    mountWidgetSize: () => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      root.render(<AnimationPreferenceProvider><WidgetSizeProbe /></AnimationPreferenceProvider>)
      return () => { root.unmount(); container.remove() }
    },
    mountRipple: () => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      root.render(<Ripple />)
      return () => { root.unmount(); container.remove() }
    },
    mountIframeSize: () => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      root.render(<IframeSize />)
      return () => { root.unmount(); container.remove() }
    },
    mountWallpaper: (fps: number) => {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      root.render(<Wallpaper fps={fps} />)
      return () => { root.unmount(); container.remove() }
    },
    renders: () => renders,
    publish: (detail: Record<string, unknown>) => {
      window.dispatchEvent(new CustomEvent('music-player-state-change', { detail }))
    },
    sharedEventManager,
    now,
    scheduleTask,
    observeResizeAtomic,
    coordinator,
    observeResize: coordinator.observeResize.bind(coordinator),
  },
})
