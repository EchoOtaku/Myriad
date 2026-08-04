import { useEffect, useRef, useState } from 'react'

export function useLibraryItemRotation(libraryItems: any[], showOverview: boolean) {
  const [currentItemIndex, setCurrentItemIndex] = useState(0)
  const prevShowOverviewRef = useRef(showOverview)

  useEffect(() => {
    // 当从概览模式切换到库项目模式时，更新索引
    if (
      prevShowOverviewRef.current &&
      !showOverview &&
      libraryItems.length > 0
    ) {
      setCurrentItemIndex((prev) => (prev + 1) % libraryItems.length)
    }
    prevShowOverviewRef.current = showOverview
  }, [showOverview, libraryItems.length])

  return { currentItem: libraryItems[currentItemIndex], currentItemIndex }
}

export function useCountUp(value: number, duration = 800, delay = 0) {
  const [display, setDisplay] = useState(() => (duration > 0 ? 0 : value))

  useEffect(() => {
    if (duration <= 0) {
      setDisplay(value)
      return
    }
    let raf = 0
    const start = performance.now() + delay
    let last = -1
    const tick = (now: number) => {
      const p = Math.min(Math.max((now - start) / duration, 0), 1)
      const eased = 1 - (1 - p) ** 3
      const next = Math.round(value * eased)
      // 只在整数显示值真的变了才 setState。delay 期间恒为 0，
      // 大数值的尾段也常常连续多帧落在同一整数上——同一张 face 挂了
      // 三个 useCountUp，省下的是三条逐帧重渲染。
      if (next !== last) {
        last = next
        setDisplay(next)
      }
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, delay])

  return display
}
