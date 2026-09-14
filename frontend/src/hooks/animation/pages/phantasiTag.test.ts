import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  PHANTASI_TAG_ENTER_MS,
  PHANTASI_TAG_EXIT_MS,
  PHANTASI_TAG_STAGGER_MS,
  phantasiTagDelay,
} from './phantasiTag.ts'

describe('phantasiTagDelay', () => {
  it('第一枚立刻走', () => {
    assert.equal(phantasiTagDelay(0), 0)
  })

  it('按序号错开，对齐 --sm-stagger', () => {
    assert.equal(PHANTASI_TAG_STAGGER_MS, 26)
    assert.equal(phantasiTagDelay(1), 26)
    assert.equal(phantasiTagDelay(3), 78)
  })

  it('降级时全部立刻走', () => {
    assert.equal(phantasiTagDelay(4, true), 0)
  })

  it('入场时长对齐 --sm-dur-slow', () => {
    assert.equal(PHANTASI_TAG_ENTER_MS, 320)
  })

  it('退场时长对齐 --sm-dur-base', () => {
    assert.equal(PHANTASI_TAG_EXIT_MS, 220)
  })
})
