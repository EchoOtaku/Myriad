import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  truncateVersionTag,
  VERSION_TAG_DISPLAY_MAX,
} from './runtimeDiagnosticsVersion'

describe('truncateVersionTag', () => {
  it('keeps short release tags intact', () => {
    assert.equal(truncateVersionTag('v0.3.22'), 'v0.3.22')
    assert.equal(truncateVersionTag('v0.3.22-rc1'), 'v0.3.22-rc1')
  })

  it('trims surrounding whitespace before measuring', () => {
    assert.equal(truncateVersionTag('  v0.3.22  '), 'v0.3.22')
  })

  it(`caps display at ${VERSION_TAG_DISPLAY_MAX} characters with an ellipsis`, () => {
    const long =
      'v0.3.22-very-long-channel-name-and-extra-suffix-that-overflows'
    const display = truncateVersionTag(long)
    assert.equal(display.length, VERSION_TAG_DISPLAY_MAX)
    assert.ok(display.endsWith('…'))
    assert.equal(
      display,
      `${long.slice(0, VERSION_TAG_DISPLAY_MAX - 1)}…`,
    )
  })

  it('respects a custom max length', () => {
    assert.equal(truncateVersionTag('abcdefghij', 6), 'abcde…')
  })

  it('handles edge max lengths', () => {
    assert.equal(truncateVersionTag('abc', 0), '')
    assert.equal(truncateVersionTag('abc', 1), '…')
    assert.equal(truncateVersionTag('ab', 2), 'ab')
  })
})
