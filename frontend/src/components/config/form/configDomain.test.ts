import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONFIG_LOAD_CONCURRENCY,
  configDomainLoadRank,
  createConfigDomain,
  executeConfigOperations,
  isPriorityConfigDomain,
  loadConfigDomains,
  reconcileConfigDraft,
} from './configDomain'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('configuration domain load scheduling', () => {
  it('keeps the concurrency cap across rapid editor remounts and cancels queued reads', async () => {
    const gate = deferred<void>()
    const started: string[] = []
    const make = (id: string) => createConfigDomain(() => ({
      id,
      initial: 0,
      persist: async (value: number) => value,
      load: async () => {
        started.push(id)
        // Simulate a server read that cannot be cancelled once started.
        await gate.promise
        return 1
      },
    }))
    const oldSession = new AbortController()
    const first = loadConfigDomains(
      [make('old-a'), make('old-b'), make('cancelled')], oldSession.signal,
    )
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(started, ['old-a', 'old-b'])
    oldSession.abort()
    const second = loadConfigDomains(
      [make('new-a'), make('new-b')], new AbortController().signal,
    )
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(started, ['old-a', 'old-b'], 'remount must wait for outstanding reads')
    gate.resolve()
    await Promise.all([first, second])
    assert.deepEqual(started, ['old-a', 'old-b', 'new-a', 'new-b'])
  })

  it('ranks the bag and the open section ahead of the rest', () => {
    assert.equal(configDomainLoadRank({ id: 'config' }, 'permissions'), 0)
    assert.equal(
      configDomainLoadRank(
        { id: 'permissions', sections: ['permissions'] },
        'permissions',
      ),
      1,
    )
    assert.equal(
      configDomainLoadRank(
        { id: 'oauth', sections: ['oauth', 'users'] },
        'permissions',
      ),
      2,
    )
    assert.equal(isPriorityConfigDomain({ id: 'config' }, 'permissions'), true)
    assert.equal(
      isPriorityConfigDomain(
        { id: 'oauth', sections: ['oauth'] },
        'permissions',
      ),
      false,
    )
    assert.equal(
      isPriorityConfigDomain({ id: 'agent', sections: ['agent'] }, ''),
      true,
    )
  })

  it('loads at most two domains at once and skips domains already in flight', async () => {
    assert.equal(CONFIG_LOAD_CONCURRENCY, 2)
    let inflight = 0
    let peak = 0
    const gate = deferred<void>()
    const make = (id: string, sections: string[] = []) => {
      const started = deferred<void>()
      const domain = createConfigDomain(() => ({
        id,
        sections,
        initial: 0,
        persist: async (value: number) => value,
        load: async () => {
          inflight++
          peak = Math.max(peak, inflight)
          started.resolve()
          await gate.promise
          inflight--
          return 1
        },
      }))
      return { domain, started: started.promise }
    }
    const first = make('config')
    const second = make('permissions', ['permissions'])
    const third = make('oauth', ['oauth'])
    const loading = loadConfigDomains(
      [third.domain, first.domain, second.domain],
      new AbortController().signal,
      'permissions',
    )
    await Promise.all([first.started, second.started])
    assert.equal(peak, 2)
    assert.equal(third.domain.getSnapshot().loading, false)
    gate.resolve()
    await loading
    assert.equal(first.domain.getSnapshot().ready, true)
    assert.equal(second.domain.getSnapshot().ready, true)
    assert.equal(third.domain.getSnapshot().ready, true)
  })
})

describe('configuration domain lifecycle', () => {
  it('keeps an interrupted canonical read pending without applying its response', async () => {
    const response = deferred<string>()
    const controller = new AbortController()
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: 'old',
      ready: true,
      readBack: true,
      persist: async (value: string) => value,
      load: () => response.promise,
    }))
    domain.setDraft('submitted')
    await domain.prepareSave()!.persist()
    const refresh = domain.flushEffects(controller.signal)
    controller.abort()
    response.resolve('canonical')
    await refresh
    assert.equal(domain.getSnapshot().saved, 'submitted')
    assert.equal(domain.getSnapshot().pendingSync, true)
    await domain.flushEffects()
    assert.equal(domain.getSnapshot().saved, 'canonical')
    assert.equal(domain.getSnapshot().pendingSync, false)
  })

  it('stops queued writes and refreshes when a save session is cancelled', async () => {
    const controller = new AbortController()
    const response = deferred<number>()
    let writes = 0
    let refreshes = 0
    const first = createConfigDomain(() => ({
      id: 'first',
      initial: 0,
      ready: true,
      persist: async () => {
        writes++
        return response.promise
      },
      effects: () => [
        {
          id: 'refresh',
          run: () => {
            refreshes++
          },
        },
      ],
    }))
    const second = createConfigDomain(() => ({
      id: 'second',
      initial: 0,
      ready: true,
      persist: async (value: number) => {
        writes++
        return value
      },
    }))
    first.setDraft(1)
    second.setDraft(2)
    const saving = executeConfigOperations(
      [first, second],
      [first.prepareSave()!, second.prepareSave()!],
      controller.signal,
    )
    controller.abort()
    response.resolve(1)
    const result = await saving
    assert.equal(result.cancelled, true)
    assert.deepEqual(result.persisted, ['first'])
    assert.equal(result.pendingSync, true)
    assert.equal(writes, 1)
    assert.equal(refreshes, 0)
    assert.equal(first.getSnapshot().saved, 1)
    assert.equal(second.getSnapshot().dirty, true)
  })

  it('cancellation during a refresh stops the following effects', async () => {
    const controller = new AbortController()
    const refreshed: string[] = []
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: 0,
      ready: true,
      persist: async (value: number) => value,
      effects: () => [
        {
          id: 'one',
          run: () => {
            refreshed.push('one')
            controller.abort()
          },
        },
        {
          id: 'two',
          run: () => {
            refreshed.push('two')
          },
        },
      ],
    }))
    domain.setDraft(1)
    const result = await executeConfigOperations(
      [domain],
      [domain.prepareSave()!],
      controller.signal,
    )
    assert.equal(result.cancelled, true)
    assert.equal(result.errors.length, 0)
    assert.deepEqual(refreshed, ['one'])
    assert.equal(result.pendingSync, true)
  })

  it('ignores obsolete failures after a newer load succeeds', async () => {
    const old = deferred<number>()
    let loads = 0
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: 0,
      load: () => (++loads === 1 ? old.promise : Promise.resolve(2)),
      persist: async (value: number) => value,
    }))
    const stale = domain.load()
    await domain.load()
    old.reject(new Error('obsolete failure'))
    await stale
    assert.equal(domain.getSnapshot().saved, 2)
    assert.equal(domain.getSnapshot().error, null)
  })

  it('does not accept a cancelled load and can load again in a new session', async () => {
    const old = deferred<number>()
    const controller = new AbortController()
    let loads = 0
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: 0,
      load: () => (++loads === 1 ? old.promise : Promise.resolve(2)),
      persist: async (value: number) => value,
    }))
    const loading = domain.load(controller.signal)
    controller.abort()
    old.resolve(1)
    await loading
    assert.equal(domain.getSnapshot().saved, 0)
    assert.equal(domain.getSnapshot().ready, false)
    assert.equal(domain.getSnapshot().loading, false)
    await domain.load()
    assert.equal(domain.getSnapshot().saved, 2)
  })

  it('acknowledges and refreshes a saved domain even when the next endpoint fails', async () => {
    const writes: string[] = []
    const effects: string[] = []
    let fail = true
    const a = createConfigDomain(() => ({
      id: 'a',
      initial: 0,
      ready: true,
      persist: async (value: number) => {
        writes.push('a')
        return value
      },
      effects: () => [
        {
          id: 'refresh',
          run: () => {
            effects.push('a')
          },
        },
      ],
    }))
    const b = createConfigDomain(() => ({
      id: 'b',
      initial: 0,
      ready: true,
      persist: async (value: number) => {
        writes.push('b')
        if (fail) throw new Error('offline')
        return value
      },
    }))
    a.setDraft(1)
    b.setDraft(2)
    const first = await executeConfigOperations(
      [a, b],
      [a.prepareSave()!, b.prepareSave()!],
    )
    assert.deepEqual(first.persisted, ['a'])
    assert.equal(first.errors.length, 1)
    assert.deepEqual(effects, ['a'])
    assert.equal(a.getSnapshot().dirty, false)
    assert.equal(b.getSnapshot().dirty, true)
    fail = false
    await executeConfigOperations([a, b], [b.prepareSave()!])
    assert.deepEqual(writes, ['a', 'b', 'b'])
    assert.deepEqual(effects, ['a'])
  })

  it('retries a failed runtime effect without resubmitting the acknowledged write', async () => {
    let writes = 0
    let attempts = 0
    let otherEffects = 0
    const domain = createConfigDomain(() => ({
      id: 'config',
      initial: 0,
      ready: true,
      persist: async (value: number) => {
        writes++
        return value
      },
      effects: () => [
        {
          id: 'runtime',
          run: () => {
            if (++attempts === 1) throw new Error('unavailable')
          },
        },
        {
          id: 'metadata',
          run: () => {
            otherEffects++
          },
        },
      ],
    }))
    domain.setDraft(1)
    assert.equal(
      (await executeConfigOperations([domain], [domain.prepareSave()!])).errors
        .length,
      1,
    )
    assert.equal(domain.getSnapshot().dirty, false)
    assert.equal(domain.getSnapshot().pendingSync, true)
    assert.equal(domain.prepareSave(), undefined)
    assert.equal((await executeConfigOperations([domain], [])).errors.length, 0)
    assert.equal(writes, 1)
    assert.equal(attempts, 2)
    assert.equal(otherEffects, 1)
    assert.equal(domain.getSnapshot().pendingSync, false)
  })

  it('a failed canonical read keeps the write acknowledged and retries only the read', async () => {
    let writes = 0
    let reads = 0
    const domain = createConfigDomain(() => ({
      id: 'oauth',
      initial: { token: 'masked', name: 'old' },
      ready: true,
      readBack: true,
      persist: async (draft: { token: string; name: string }) => {
        writes++
        return draft
      },
      load: async () => {
        if (++reads === 1) throw new Error('read unavailable')
        return { token: 'masked', name: 'submitted' }
      },
    }))
    domain.setDraft({ token: 'submitted secret', name: 'submitted' })
    const first = await executeConfigOperations(
      [domain],
      [domain.prepareSave()!],
    )
    assert.deepEqual(first.persisted, ['oauth'])
    assert.equal(first.errors.length, 1)
    assert.equal(domain.getSnapshot().dirty, false)
    assert.equal(domain.getSnapshot().pendingSync, true)
    assert.equal(domain.prepareSave(), undefined)
    domain.setDraft((current) => ({ ...current, name: 'new edit' }))
    await executeConfigOperations([domain], [])
    assert.deepEqual(domain.getSnapshot().draft, {
      token: 'masked',
      name: 'new edit',
    })
    assert.equal(domain.getSnapshot().dirty, true)
    assert.equal(domain.getSnapshot().pendingSync, false)
    assert.equal(writes, 1)
    assert.equal(reads, 2)
  })

  it('retries dependent refreshes only after the runtime prerequisite succeeds', async () => {
    let fail = true
    const refreshed: string[] = []
    const domain = createConfigDomain(() => ({
      id: 'config',
      initial: 0,
      ready: true,
      persist: async (value: number) => value,
      effects: () => [
        {
          id: 'runtime',
          run: () => {
            if (fail) throw new Error('reload failed')
            refreshed.push('runtime')
          },
        },
        {
          id: 'persona',
          after: ['runtime'],
          run: () => {
            refreshed.push('persona')
          },
        },
      ],
    }))
    domain.setDraft(1)
    await executeConfigOperations([domain], [domain.prepareSave()!])
    assert.deepEqual(refreshed, [])
    fail = false
    await executeConfigOperations([domain], [])
    assert.deepEqual(refreshed, ['runtime', 'persona'])
    assert.equal(domain.getSnapshot().pendingSync, false)
  })

  it('drains a retained dependent after a newly queued prerequisite in the same save', async () => {
    let fail = true
    const refreshed: string[] = []
    const domain = createConfigDomain(() => ({
      id: 'config',
      initial: 0,
      ready: true,
      persist: async (value: number) => value,
      effects: () => [
        {
          id: 'runtime',
          run: () => {
            refreshed.push('runtime')
          },
        },
        {
          id: 'speech',
          after: ['runtime'],
          run: () => {
            refreshed.push('speech')
            if (fail) throw new Error('speech refresh failed')
          },
        },
      ],
    }))
    domain.setDraft(1)
    const first = await executeConfigOperations(
      [domain],
      [domain.prepareSave()!],
    )
    assert.equal(first.errors.length, 1)
    assert.deepEqual(refreshed, ['runtime', 'speech'])
    fail = false
    refreshed.length = 0
    domain.setDraft(2)
    const second = await executeConfigOperations(
      [domain],
      [domain.prepareSave()!],
    )
    assert.equal(second.errors.length, 0)
    assert.deepEqual(refreshed, ['runtime', 'speech'])
    assert.equal(domain.getSnapshot().pendingSync, false)
  })

  it('reports cyclic pending effects instead of claiming synchronization succeeded', async () => {
    const domain = createConfigDomain(() => ({
      id: 'config',
      initial: 0,
      ready: true,
      persist: async (value: number) => value,
      effects: () => [
        { id: 'a', after: ['b'], run: () => assert.fail('cycle must not run') },
        { id: 'b', after: ['a'], run: () => assert.fail('cycle must not run') },
      ],
    }))
    domain.setDraft(1)
    const result = await executeConfigOperations(
      [domain],
      [domain.prepareSave()!],
    )
    assert.equal(result.errors.length, 1)
    assert.equal(domain.getSnapshot().pendingSync, true)
  })

  it('keeps edits made while saving and accepts the canonical secret mask', async () => {
    const response = deferred<{ name: string; token: string }>()
    const domain = createConfigDomain(() => ({
      id: 'oauth',
      initial: { name: 'old', token: 'mask' },
      ready: true,
      persist: () => response.promise,
    }))
    domain.setDraft({ name: 'submitted', token: 'new secret' })
    const save = domain.prepareSave()!.persist()
    domain.setDraft((value) => ({ ...value, name: 'newer edit' }))
    response.resolve({ name: 'submitted', token: 'masked' })
    await save
    assert.deepEqual(domain.getSnapshot().draft, {
      name: 'newer edit',
      token: 'masked',
    })
    assert.deepEqual(domain.getSnapshot().saved, {
      name: 'submitted',
      token: 'masked',
    })
    assert.equal(domain.getSnapshot().dirty, true)
  })

  it('merges keyed fields after list reordering without overwriting new edits', () => {
    assert.deepEqual(
      reconcileConfigDraft(
        [
          { key: 'b', value: 'new edit' },
          { key: 'a', value: 'secret' },
        ],
        [
          { key: 'a', value: 'secret' },
          { key: 'b', value: 'old' },
        ],
        [
          { key: 'a', value: 'masked' },
          { key: 'b', value: 'old' },
        ],
      ),
      [
        { key: 'b', value: 'new edit' },
        { key: 'a', value: 'masked' },
      ],
    )
  })

  it('page reset submits persisted siblings and preserves their unsaved drafts', async () => {
    const writes: { page: string; sibling: string }[] = []
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: { page: 'saved', sibling: 'saved' },
      ready: true,
      persist: async (value: { page: string; sibling: string }) => {
        writes.push(value)
        return value
      },
      reset: (value: { page: string; sibling: string }, scope: string) =>
        scope === 'page' ? { ...value, page: 'default' } : undefined,
    }))
    domain.setDraft({ page: 'unsaved', sibling: 'unsaved sibling' })
    await executeConfigOperations([domain], [domain.prepareReset('page')!])
    assert.deepEqual(writes, [{ page: 'default', sibling: 'saved' }])
    assert.deepEqual(domain.getSnapshot().draft, {
      page: 'default',
      sibling: 'unsaved sibling',
    })
    assert.equal(domain.getSnapshot().dirty, true)
  })

  it('a failed reset leaves the complete original draft and snapshot intact', async () => {
    const domain = createConfigDomain(() => ({
      id: 'page',
      initial: 'saved',
      ready: true,
      persist: async (): Promise<string> => {
        throw new Error('offline')
      },
      reset: () => 'default',
    }))
    domain.setDraft('unsaved')
    await executeConfigOperations([domain], [domain.prepareReset('page')!])
    assert.equal(domain.getSnapshot().draft, 'unsaved')
    assert.equal(domain.getSnapshot().saved, 'saved')
    assert.equal(domain.getSnapshot().dirty, true)
  })

  it('preserves edits made while a reset is in flight', async () => {
    const response = deferred<{ page: string; sibling: string }>()
    const domain = createConfigDomain(() => ({
      id: 'page',
      initial: { page: 'saved', sibling: 'saved' },
      ready: true,
      persist: () => response.promise,
      reset: (value: { page: string; sibling: string }) => ({
        ...value,
        page: 'default',
      }),
    }))
    domain.setDraft({ page: 'old edit', sibling: 'unsaved sibling' })
    const reset = domain.prepareReset('page')!.persist()
    domain.setDraft((current) => ({ ...current, page: 'typed during reset' }))
    response.resolve({ page: 'default', sibling: 'saved' })
    await reset
    assert.deepEqual(domain.getSnapshot().draft, {
      page: 'typed during reset',
      sibling: 'unsaved sibling',
    })
  })

  it('ignores an obsolete load response after a newer load or an acknowledged save', async () => {
    const stale = deferred<number>()
    const fresh = deferred<number>()
    let loads = 0
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: 0,
      ready: true,
      load: () => (++loads === 1 ? stale.promise : fresh.promise),
      persist: async (value: number) => value,
    }))
    const oldLoad = domain.load()
    const newLoad = domain.load()
    fresh.resolve(2)
    await newLoad
    domain.setDraft(3)
    await domain.prepareSave()!.persist()
    stale.resolve(1)
    await oldLoad
    assert.equal(domain.getSnapshot().saved, 3)
    assert.equal(domain.getSnapshot().draft, 3)
  })

  it('reload preserves pre-existing dirty fields while accepting fresh clean fields', async () => {
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: { edited: 'old', clean: 'old' },
      ready: true,
      persist: async (value: { edited: string; clean: string }) => value,
      load: async () => ({ edited: 'server', clean: 'fresh' }),
    }))
    domain.setDraft({ edited: 'unsaved', clean: 'old' })
    await domain.load()
    assert.deepEqual(domain.getSnapshot().draft, {
      edited: 'unsaved',
      clean: 'fresh',
    })
    assert.deepEqual(domain.getSnapshot().saved, {
      edited: 'server',
      clean: 'fresh',
    })
  })

  it('a failed initial load cannot silently submit defaults', async () => {
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial: 0,
      load: async (): Promise<number> => {
        throw new Error('offline')
      },
      persist: async (value: number) => value,
      reset: () => 0,
    }))
    await assert.rejects(domain.load())
    domain.setDraft(2)
    assert.equal(domain.prepareSave(), undefined)
    await assert.rejects(domain.prepareReset('all')!.persist())
    assert.equal(domain.getSnapshot().ready, false)
  })

  it('does not mutate earlier snapshots or the default object', () => {
    const initial = { fields: [{ key: 'one', value: 'old' }] }
    const domain = createConfigDomain(() => ({
      id: 'bag',
      initial,
      ready: true,
      persist: async (value: typeof initial) => value,
    }))
    const before = domain.getSnapshot()
    domain.setDraft((value) => ({
      ...value,
      fields: value.fields.map((field) => ({ ...field, value: 'new' })),
    }))
    assert.equal(before.draft.fields[0].value, 'old')
    assert.equal(initial.fields[0].value, 'old')
    assert.equal(domain.getSnapshot().saved.fields[0].value, 'old')
  })
})
