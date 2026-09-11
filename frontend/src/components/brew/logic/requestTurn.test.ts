import assert from 'node:assert/strict'
import { it } from 'node:test'
import { RequestTurn, unlessAborted } from './requestTurn'

it('only the latest open intent may commit and close invalidates it', async () => {
  const turns = new RequestTurn()
  const releases: (() => void)[] = []
  const shown: string[] = []
  const open = (id: string) => {
    const signal = turns.begin()
    return new Promise<void>((resolve) => releases.push(resolve)).then(() => {
      if (!signal.aborted) shown.push(id)
    })
  }
  const a = open('A')
  const b = open('B')
  const c = open('C')
  releases[1]()
  releases[2]()
  releases[0]()
  await Promise.all([a, b, c])
  assert.deepEqual(shown, ['C'])
  const d = open('D')
  turns.cancel()
  releases[3]()
  await d
  assert.deepEqual(shown, ['C'])
})

it('does not apply work after the turn is cancelled', () => {
  const turns = new RequestTurn()
  const signal = turns.begin()
  let applied = false
  turns.cancel()
  assert.equal(
    unlessAborted(signal, () => {
      applied = true
    }),
    false,
  )
  assert.equal(applied, false)
  const live = turns.begin()
  assert.equal(
    unlessAborted(live, () => {
      applied = true
    }),
    true,
  )
  assert.equal(applied, true)
})
