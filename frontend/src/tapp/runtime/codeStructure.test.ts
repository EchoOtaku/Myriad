/**
 * Pure-function tests for layer entry selection and iframe fingerprints.
 * Run from frontend/:
 *   node --experimental-strip-types --test src/tapp/runtime/codeStructure.test.ts
 */

import type { TappCodeStructure } from '../types'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildLayerScript,
  getCodeStructureFingerprint,
  getLayerEntries,
} from './codeStructure.ts'

function sampleCode(): TappCodeStructure {
  return {
    modules: {
      'core.js': 'module.exports = { shared: true };',
      'page/index.js': 'require("../core.js");',
      'widget/index.js': 'require("../core.js");',
    },
    coreEntry: 'core.js',
    pageEntry: 'page/index.js',
    widgetEntries: { card: 'widget/index.js' },
  }
}

describe('getLayerEntries', () => {
  /// core 是共享层：三种模式都先执行它，模块化不改变这一点。
  it('always runs core first', () => {
    const code = sampleCode()
    assert.deepEqual(getLayerEntries(code, 'page'), [
      'core.js',
      'page/index.js',
    ])
    assert.deepEqual(getLayerEntries(code, 'widget', 'card'), [
      'core.js',
      'widget/index.js',
    ])
    assert.deepEqual(getLayerEntries(code, 'background'), ['core.js'])
  })

  it('keeps page code out of widget mode and vice versa', () => {
    const code = sampleCode()
    assert.ok(!getLayerEntries(code, 'widget', 'card').includes('page/index.js'))
    assert.ok(!getLayerEntries(code, 'page').includes('widget/index.js'))
  })

  /// 一个 widget 的 iframe 不该执行同 Tapp 其它 widget 的代码；想共用就各自
  /// require 同一个文件。
  it('loads only the named widget entry', () => {
    const code = sampleCode()
    code.modules['widget-a.js'] = 'a();'
    code.modules['widget-b.js'] = 'b();'
    code.widgetEntries = { a: 'widget-a.js', b: 'widget-b.js' }

    assert.deepEqual(getLayerEntries(code, 'widget', 'a'), [
      'core.js',
      'widget-a.js',
    ])
    const { source } = buildLayerScript(code, 'widget', 'a')
    assert.ok(source.includes('"widget-a.js"'))
    assert.ok(!source.includes('"widget-b.js"'))
  })

  /// 漏传 widgetId 不该退化成「装入全部 widget」——那会让漏传看起来正常工作。
  it('loads no widget entry without a widget id', () => {
    assert.deepEqual(getLayerEntries(sampleCode(), 'widget'), ['core.js'])
  })
})

describe('buildLayerScript', () => {
  it('emits nothing for a layer with no entries', () => {
    const code = sampleCode()
    delete code.coreEntry
    delete code.widgetEntries
    assert.equal(buildLayerScript(code, 'widget').source, '')
  })

  it('emits a runnable module registry for the layer', () => {
    const { source, includedModules } = buildLayerScript(sampleCode(), 'page')
    assert.ok(source.includes('"core.js"'))
    assert.ok(source.includes('"page/index.js"'))
    assert.ok(!source.includes('"widget/index.js"'))
    // 计划同时给出装入清单，调用方不必为调试输出再算一遍依赖图
    assert.deepEqual(includedModules, ['core.js', 'page/index.js'])
  })
})

describe('getCodeStructureFingerprint', () => {
  it('changes when a module in the dependency graph changes', () => {
    const before = getCodeStructureFingerprint(sampleCode(), 'page')
    const code = sampleCode()
    code.modules['core.js'] = 'module.exports = { shared: false };'
    assert.notEqual(before, getCodeStructureFingerprint(code, 'page'))
  })

  /// 无关层的代码变化不该重建这个 iframe。
  it('ignores modules outside the layer graph', () => {
    const before = getCodeStructureFingerprint(sampleCode(), 'page')
    const code = sampleCode()
    code.modules['widget/index.js'] = 'require("../core.js"); var extra = 1;'
    assert.equal(before, getCodeStructureFingerprint(code, 'page'))
  })

  it('distinguishes equal-length edits', () => {
    const before = getCodeStructureFingerprint(sampleCode(), 'background')
    const code = sampleCode()
    code.modules['core.js'] = 'module.exports = { shared: TRUE };'
    assert.notEqual(before, getCodeStructureFingerprint(code, 'background'))
  })
})
