/* eslint-disable test/no-import-node-test -- node:test is the repository test runner */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectOsKind,
  evaluateHighHardware,
  parseIosMajorVersion,
  type HardwareSignals,
} from './deviceHardwareTier'

describe('detectOsKind', () => {
  it('detects android before linux', () => {
    assert.equal(
      detectOsKind(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
        null,
      ),
      'android',
    )
  })

  it('detects iPhone', () => {
    assert.equal(
      detectOsKind(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)',
        null,
      ),
      'ios',
    )
  })

  it('detects windows', () => {
    assert.equal(
      detectOsKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', null),
      'windows',
    )
  })
})

describe('parseIosMajorVersion', () => {
  it('parses iPhone OS version', () => {
    assert.equal(
      parseIosMajorVersion(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X)',
      ),
      18,
    )
  })

  it('parses older iOS', () => {
    assert.equal(
      parseIosMajorVersion(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)',
      ),
      16,
    )
  })
})

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
