import assert from 'node:assert/strict'
import { it } from 'node:test'
import { phantasiSubjectKey, PhantasiSubjectScope } from './phantasiSubject'

it('invalidates and aborts previous users and roles before notifying consumers', () => {
  let invalidated = 0
  const scope = new PhantasiSubjectScope(() => {
    invalidated++
  })
  scope.change(phantasiSubjectKey({ id: 1, is_admin: true }))
  const admin = scope.capture()
  let notified = false
  scope.subscribe(() => {
    notified = true
    assert.equal(admin.signal.aborted, true)
    assert.equal(invalidated, 2)
  })
  scope.change(phantasiSubjectKey({ id: 1, is_admin: false }))
  assert.equal(notified, true)
  assert.throws(() => scope.assert(admin), { name: 'AbortError' })
})

it('rejects work during an identity transition and preserves unchanged probes', () => {
  const scope = new PhantasiSubjectScope(() => {})
  const guest = scope.capture()
  scope.change('guest')
  assert.equal(scope.capture(), guest)
  scope.change('changing', false)
  assert.throws(() => scope.capture(), { name: 'AbortError' })
  scope.change('user:2:member')
  assert.throws(() => scope.assert(guest), { name: 'AbortError' })
  assert.equal(scope.capture().key, 'user:2:member')
})
