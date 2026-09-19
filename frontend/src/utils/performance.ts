import {
  startFpsMonitor as _startFpsMonitor,
  stopFpsMonitor as _stopFpsMonitor,
} from '../hooks/animation'

export function startFpsMonitor(): void {
  _startFpsMonitor()
}

export function stopFpsMonitor(): void {
  _stopFpsMonitor()
}

export class MemoryManager {
  private static cache = new Map<string, any>()
  private static maxSize = 50

  static set(key: string, value: any): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, value)
  }

  static get(key: string): any {
    return this.cache.get(key)
  }

  static has(key: string): boolean {
    return this.cache.has(key)
  }

  static clear(): void {
    this.cache.clear()
  }

  static getSize(): number {
    return this.cache.size
  }
}
