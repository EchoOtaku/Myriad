interface TaskAttribution {
  containerType?: string
  containerName?: string
  containerSrc?: string
  name?: string
}

interface LoafScript {
  sourceURL?: string
  sourceFunctionName?: string
  duration?: number
}

function clip(value: string): string {
  return value.replace(/^https?:\/\/[^/]+/i, '').slice(0, 48)
}

export function longTaskSourceOf(entry: PerformanceEntry): string {
  const attribution = (
    entry as PerformanceEntry & {
      attribution?: ReadonlyArray<TaskAttribution>
    }
  ).attribution?.[0]
  if (!attribution) return ''
  return clip(
    attribution.containerSrc ||
      attribution.containerName ||
      attribution.containerType ||
      attribution.name ||
      '',
  )
}

export function loafSourceOf(entry: PerformanceEntry): string {
  const scripts = (
    entry as PerformanceEntry & { scripts?: ReadonlyArray<LoafScript> }
  ).scripts
  if (!scripts?.length) return ''
  let top = scripts[0]
  for (let i = 1; i < scripts.length; i++) {
    if ((scripts[i]?.duration ?? 0) > (top.duration ?? 0)) top = scripts[i]!
  }
  const file = top.sourceURL?.split('/').pop() || top.sourceFunctionName || ''
  return clip(file)
}
