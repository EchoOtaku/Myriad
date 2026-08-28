import { useCallback, useEffect, useState } from 'react'
import { debounce, throttle } from '../utils/performance'

/**
 * 防抖 Hook - 延迟更新值直到指定时间内没有新的变化
 * @param value 要防抖的值
 * @param delay 延迟时间(毫秒)
 * @returns 防抖后的值
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

/**
 * 防抖回调Hook - 优化频繁触发的函数调用
 * @param callback 原始回调
 * @param delay 延迟时间(ms)
 * @param deps 依赖数组
 * @returns 防抖后的回调
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300,
  deps: React.DependencyList = [],
): T {
  return useCallback(debounce(callback, delay) as T, [delay, ...deps])
}

