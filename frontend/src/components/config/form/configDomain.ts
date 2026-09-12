import { deepEqual } from '../../../utils/deepEqual'

export type ConfigResetScope = string
export type DraftUpdate<T> = T | ((current: T) => T)
export interface ConfigEffect {
  id: string
  after?: string[]
  run: () => void | Promise<void>
}
export interface ConfigDomainOptions<T> {
  id: string
  sections?: readonly string[]
  initial: T
  ready?: boolean
  load?: () => Promise<T>
  /** Read canonical values after an acknowledged write, retrying reads without repeating writes. */
  readBack?: boolean
  persist: (submitted: T, previous: T) => Promise<T>
  reset?: (saved: T, scope: ConfigResetScope) => T | undefined
  effects?: (saved: T, previous: T) => ConfigEffect[]
  equal?: (left: T, right: T) => boolean
}

/** Accept canonical server values only where the user has not edited since submission. */
export function reconcileConfigDraft<T>(current: T, submitted: T, saved: T): T {
  if (deepEqual(current, submitted)) return structuredClone(saved)
  if (
    !current ||
    !submitted ||
    !saved ||
    typeof current !== 'object' ||
    typeof submitted !== 'object' ||
    typeof saved !== 'object'
  ) {
    return current
  }
  if (
    Array.isArray(current) ||
    Array.isArray(submitted) ||
    Array.isArray(saved)
  ) {
    if (
      !Array.isArray(current) ||
      !Array.isArray(submitted) ||
      !Array.isArray(saved)
    ) {
      return current
    }
    // Lists can be reordered or extended while saving. Match stable identities where available.
    const identity = (value: unknown): unknown => {
      if (!value || typeof value !== 'object') return undefined
      for (const key of ['key', 'slug', 'name', 'id']) {
        if (key in value) return (value as Record<string, unknown>)[key]
      }
      return undefined
    }
    if (!current.every((item) => identity(item) !== undefined)) return current
    return current.map((item) => {
      const before = submitted.find(
        (entry) => identity(entry) === identity(item),
      )
      const after = saved.find((entry) => identity(entry) === identity(item))
      return before !== undefined && after !== undefined
        ? reconcileConfigDraft(item, before, after)
        : item
    }) as T
  }
  const next = { ...current } as Record<string, unknown>
  for (const key of new Set([
    ...Object.keys(submitted),
    ...Object.keys(saved),
  ])) {
    const currentRecord = current as Record<string, unknown>
    const submittedRecord = submitted as Record<string, unknown>
    const savedRecord = saved as Record<string, unknown>
    if (!(key in savedRecord)) {
      if (
        key in currentRecord &&
        deepEqual(currentRecord[key], submittedRecord[key])
      ) {
        delete next[key]
      }
    } else if (!(key in submittedRecord)) {
      if (!(key in currentRecord)) next[key] = structuredClone(savedRecord[key])
    } else if (key in currentRecord) {
      next[key] = reconcileConfigDraft(
        currentRecord[key],
        submittedRecord[key],
        savedRecord[key],
      )
    }
  }
  return next as T
}

export interface ConfigOperation {
  id: string
  persist: () => Promise<void>
}
export interface ConfigDomainController {
  id: string
  prepareSave: () => ConfigOperation | undefined
  prepareReset: (scope: ConfigResetScope) => ConfigOperation | undefined
  flushEffects: () => Promise<unknown[]>
}

/** One endpoint owns its draft, acknowledged snapshot, and retryable runtime effects. */
export function createConfigDomain<T>(
  getOptions: () => ConfigDomainOptions<T>,
) {
  const initial = structuredClone(getOptions().initial)
  let state = {
    draft: initial,
    saved: structuredClone(initial),
    ready: getOptions().ready ?? false,
    loading: false,
    error: null as unknown,
    dirty: false,
    pendingSync: false,
  }
  const listeners = new Set<() => void>()
  const pending = new Map<string, ConfigEffect>()
  let loadGeneration = 0
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch }
    state.dirty =
      state.ready &&
      !(getOptions().equal ?? deepEqual)(state.draft, state.saved)
    state.pendingSync = pending.size > 0
    listeners.forEach((listener) => listener())
  }
  const operation = (
    submitted: T,
    scope?: ConfigResetScope,
  ): ConfigOperation => {
    const previous = structuredClone(state.saved)
    const draftAtStart = structuredClone(state.draft)
    const options = getOptions()
    return {
      id: options.id,
      persist: async () => {
        if (!state.ready)
          throw new Error(`Configuration has not loaded: ${options.id}`)
        const saved = await options.persist(submitted, previous)
        // A later load must never overwrite an acknowledged write.
        loadGeneration += 1
        for (const effect of options.effects?.(saved, previous) ?? [])
          pending.set(effect.id, effect)
        if (options.readBack && options.load) {
          const read = options.load
          pending.set('persisted-snapshot', {
            id: 'persisted-snapshot',
            run: async () => {
              const baseline = state.saved
              const generation = ++loadGeneration
              const canonical = await read()
              if (generation !== loadGeneration) return
              publish({
                loading: false,
                saved: structuredClone(canonical),
                draft: reconcileConfigDraft(state.draft, baseline, canonical),
              })
            },
          })
        }
        const draft = scope
          ? reconcileConfigDraft(
              state.draft,
              draftAtStart,
              reconcileConfigDraft(
                options.reset!(draftAtStart, scope)!,
                submitted,
                saved,
              ),
            )
          : reconcileConfigDraft(state.draft, submitted, saved)
        publish({
          saved: structuredClone(saved),
          draft,
          loading: false,
          error: null,
        })
      },
    }
  }
  return {
    id: getOptions().id,
    sections: getOptions().sections ?? [],
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setDraft: (update: DraftUpdate<T>) => {
      const draft =
        typeof update === 'function'
          ? (update as (current: T) => T)(state.draft)
          : update
      if (!Object.is(draft, state.draft)) publish({ draft })
    },
    /** A separate endpoint has already persisted this patch. */
    acceptPatch: (patch: (current: T) => T) => {
      publish({ draft: patch(state.draft), saved: patch(state.saved) })
    },
    load: async () => {
      const loader = getOptions().load
      if (!loader) return
      const generation = ++loadGeneration
      const baseline = state.ready ? state.saved : state.draft
      publish({ loading: true, error: null })
      try {
        const saved = await loader()
        if (generation !== loadGeneration) return
        publish({
          saved: structuredClone(saved),
          draft: reconcileConfigDraft(state.draft, baseline, saved),
          ready: true,
          loading: false,
        })
      } catch (error) {
        if (generation === loadGeneration) publish({ error, loading: false })
        throw error
      }
    },
    prepareSave: () =>
      state.dirty ? operation(structuredClone(state.draft)) : undefined,
    prepareReset: (scope: ConfigResetScope) => {
      const next = getOptions().reset?.(structuredClone(state.saved), scope)
      return next === undefined ? undefined : operation(next, scope)
    },
    flushEffects: async () => {
      if (pending.size === 0) return []
      const errors: unknown[] = []
      const attempted = new Set<string>()
      // Retried effects keep their Map position. A newly queued prerequisite
      // can appear later, so revisit dependents after each successful refresh.
      while (true) {
        const runnable = [...pending].find(
          ([id, effect]) =>
            !attempted.has(id) &&
            !effect.after?.some((dependency) => pending.has(dependency)),
        )
        if (!runnable) break
        const [id, effect] = runnable
        attempted.add(id)
        try {
          await effect.run()
          if (pending.get(id) === effect) pending.delete(id)
        } catch (error) {
          errors.push(error)
        }
      }
      if (pending.size > 0 && errors.length === 0) {
        errors.push(
          new Error('Configuration refresh dependencies could not be resolved'),
        )
      }
      publish({})
      return errors
    },
  }
}

/** Writes are independent, not a transaction. Always synchronize every acknowledged write. */
export async function executeConfigOperations(
  domains: ConfigDomainController[],
  operations: ConfigOperation[],
) {
  const persisted: string[] = []
  const errors: unknown[] = []
  for (const operation of operations) {
    try {
      await operation.persist()
      persisted.push(operation.id)
    } catch (error) {
      errors.push(error)
      break
    }
  }
  for (const domain of domains) errors.push(...(await domain.flushEffects()))
  return { persisted, errors }
}
