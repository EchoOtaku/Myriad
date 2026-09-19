import { getRandomQuote, getWeatherInfo } from '../../utils/dynamicContent'
import { globalResourceLoader, loadResource } from '../../utils/resourceLoader'

export const builtinIslandResources = { weather: getWeatherInfo, quote: getRandomQuote }
let nextRequest = 0

/** Every effect lifetime owns a task, including Strict Mode remounts and locale changes. */
export function loadIslandResource<T>(name: string, load: () => Promise<T>, receive: (data: T) => void): () => void {
  const id = `island-${name}-${++nextRequest}`
  let active = true
  loadResource.high(id, async signal => {
    try {
      const data = await load()
      if (active && !signal.aborted) receive(data)
    } catch (error) {
      if (active && !signal.aborted) console.debug(`[Island] ${name} unavailable:`, error)
    }
  })
  return () => {
    active = false
    globalResourceLoader.cancelTask(id)
  }
}
