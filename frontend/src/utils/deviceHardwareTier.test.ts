/* eslint-disable test/no-import-node-test -- node:test is the repository test runner */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateHighHardware,
  type HardwareSignals,
} from './deviceHardwareTier'

function sig(partial: Partial<HardwareSignals>): HardwareSignals {
  return {
    os: 'unknown',
    cores: null,
    memoryGiB: null,
    iosMajor: null,
    appleSilicon: null,
    ...partial,
  }
}

describe('evaluateHighHardware', () => {
  it('android requires 8GB bucket and 8 cores', () => {
    assert.equal(
      evaluateHighHardware(sig({ os: 'android', memoryGiB: 8, cores: 8 }))
        .highHardware,
      true,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'android', memoryGiB: 4, cores: 8 }))
        .highHardware,
      false,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'android', memoryGiB: 8, cores: 6 }))
        .highHardware,
      false,
    )
  })

  it('ios high when major >= 18', () => {
    assert.equal(
      evaluateHighHardware(sig({ os: 'ios', iosMajor: 18 })).highHardware,
      true,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'ios', iosMajor: 26 })).highHardware,
      true,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'ios', iosMajor: 17 })).highHardware,
      false,
    )
  })

  it('macos M-series high, Intel low', () => {
    assert.equal(
      evaluateHighHardware(sig({ os: 'macos', appleSilicon: true }))
        .highHardware,
      true,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'macos', appleSilicon: false }))
        .highHardware,
      false,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'macos', appleSilicon: null }))
        .highHardware,
      false,
    )
  })

  it('windows/linux need ~12GB bucket (>=8) and 6+ cores', () => {
    assert.equal(
      evaluateHighHardware(sig({ os: 'windows', memoryGiB: 8, cores: 6 }))
        .highHardware,
      true,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'linux', memoryGiB: 8, cores: 4 }))
        .highHardware,
      false,
    )
    assert.equal(
      evaluateHighHardware(sig({ os: 'windows', memoryGiB: 4, cores: 8 }))
        .highHardware,
      false,
    )
  })
})
